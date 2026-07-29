# Publishing images to GHCR

One-time setup so your repository can push images to the GitHub Container
Registry. Skip this entirely if someone else publishes the image and you only
want to run it: that is [deploy.md](deploy.md).

## The two workflows

| File | Runs on | Does |
|------|---------|------|
| `.github/workflows/ci.yml` | every push and PR | lint, typecheck, test, `npm run build`, plus a Docker build and `/api/health` smoke test. **Never pushes an image** |
| `.github/workflows/publish.yml` | pushes to `main`, `v*.*.*` tags, manual dispatch | builds and **pushes to ghcr.io** |

Tagging: a push to `main` publishes `:edge`, `:main` and `:sha-<commit>`. A
`vX.Y.Z` tag publishes `:X.Y.Z`, `:X.Y`, `:X` and `:latest`. A pre-release tag
(`v1.2.0-rc.1`) publishes only that exact version and moves none of the others.

## 1. Workflow permissions

GitHub → repo → **Settings** → **Actions** → **General** → **Workflow
permissions**. Either setting works, because `publish.yml` requests what it
needs explicitly:

```yaml
permissions:
  contents: read        # check out the repo
  packages: write       # push to ghcr.io
  id-token: write       # sign the provenance attestation
  attestations: write   # record it against the repo
```

No secret needs creating: the workflow logs in with the `GITHUB_TOKEN` Actions
injects automatically.

What breaks this is an **organisation** policy that caps workflow permissions
below `packages: write`. If the push fails with `denied: installation not
allowed`, that cap is the reason, and an org owner has to lift it under
Organisation Settings → Actions → General.

## 2. Trigger the first publish

Merging to `main` publishes `:edge`. For a real release:

```bash
npm version 1.0.0 --no-git-tag-version   # keeps package.json in step
git commit -am "Release 1.0.0"
git tag v1.0.0
git push origin main --tags
```

Watch it under **Actions** → *Publish container image*. The run ends with a
summary listing every tag it pushed and the image digest.

**The first run takes 15–25 minutes.** arm64 is built under QEMU emulation and
the Next.js build dominates. Later runs hit the layer cache.

## 3. Make the package public

**This is the step people miss.** The first successful push creates the package
as **private**, regardless of whether the repository is public. Until you change
it, `docker pull` fails with `denied` or `manifest unknown` for everyone,
including you on another machine.

GitHub → your **profile or org** page → **Packages** → **samband** → **Package
settings** → **Danger Zone** → **Change package visibility** → **Public**.

Do this once; later pushes keep whatever visibility the package has. While you
are there, under **Manage Actions access**, confirm the `samband` repository is
listed with at least **Write**.

## 4. Verify

```bash
# From any machine, with no login at all:
docker pull ghcr.io/whoopsi-daisy/samband:latest
```

## Skipping arm64

If everything you run is x86, halve the build time. Either run the workflow
manually: **Actions** → *Publish container image* → **Run workflow** → set
**Platforms** to `linux/amd64`, or make it permanent in
`.github/workflows/publish.yml`:

```yaml
platforms: ${{ inputs.platforms || 'linux/amd64' }}
```

## Keeping the image private instead

Skip step 3 and have each server authenticate. Create a token at **Settings** →
**Developer settings** → **Personal access tokens** → **Tokens (classic)** with
only the **`read:packages`** scope, then on the server:

```bash
echo "ghp_yourtoken" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

The login persists in `~/.docker/config.json`, so `docker compose pull` works
from then on.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Push fails: `denied: installation not allowed` | The workflow lacks `packages: write`, almost always an org-level cap. See step 1 |
| Pull fails: `denied` or `manifest unknown` | The package is still private. See step 3: a public *repo* does not make the *package* public |
| Pull fails: `unauthorized: authentication required` | Private package and you are not logged in. See "keeping the image private" |
| `exec format error` on start | Wrong architecture: built amd64-only, running on arm64. Rebuild with both platforms |
| Workflow did not run at all | `publish.yml` only triggers on `main` and `v*.*.*` tags. A feature branch runs `ci.yml` only, by design |
