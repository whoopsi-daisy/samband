import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminSetupForm from '@/components/AdminSetupForm';

const PASSWORD = 'ett-riktigt-langt-losenord';

function fill(fields: { token?: string; username?: string; password?: string; confirm?: string }) {
  if (fields.token !== undefined) {
    fireEvent.change(screen.getByLabelText('Installationsnyckel'), {
      target: { value: fields.token },
    });
  }
  if (fields.username !== undefined) {
    fireEvent.change(screen.getByLabelText('Användarnamn'), { target: { value: fields.username } });
  }
  if (fields.password !== undefined) {
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: fields.password } });
  }
  if (fields.confirm !== undefined) {
    fireEvent.change(screen.getByLabelText('Upprepa lösenordet'), {
      target: { value: fields.confirm },
    });
  }
}

const submit = () => screen.getByRole('button', { name: /Skapa konto/ });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ username: 'vakthavande', createdAt: '2026-08-01T10:00:00.000Z' }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the first-run form', () => {
  it('will not submit until every field is answered', () => {
    render(<AdminSetupForm tokenRequired />);
    expect(submit()).toBeDisabled();

    fill({ token: 'nyckel', username: 'vakthavande', password: PASSWORD, confirm: PASSWORD });
    expect(submit()).toBeEnabled();
  });

  // A typo in a field nobody can read back should cost a glance, not a round
  // trip and a rejection.
  it('catches a mistyped confirmation in the page', () => {
    render(<AdminSetupForm tokenRequired />);
    fill({ token: 'nyckel', username: 'vakthavande', password: PASSWORD, confirm: `${PASSWORD}x` });

    expect(screen.getByText('Lösenorden matchar inte.')).toBeInTheDocument();
    expect(screen.getByLabelText('Upprepa lösenordet')).toHaveAttribute('aria-invalid', 'true');
    expect(submit()).toBeDisabled();
  });

  it('holds out for a password long enough to be worth hashing', () => {
    render(<AdminSetupForm tokenRequired />);
    fill({ token: 'nyckel', username: 'vakthavande', password: 'kort', confirm: 'kort' });
    expect(submit()).toBeDisabled();
  });

  it('drops the key field when the deployment waived it', () => {
    render(<AdminSetupForm tokenRequired={false} />);
    expect(screen.queryByLabelText('Installationsnyckel')).not.toBeInTheDocument();

    fill({ username: 'vakthavande', password: PASSWORD, confirm: PASSWORD });
    expect(submit()).toBeEnabled();
  });

  it('sends what was typed, without the confirmation', async () => {
    render(<AdminSetupForm tokenRequired />);
    fill({ token: ' nyckel ', username: ' vakthavande ', password: PASSWORD, confirm: PASSWORD });
    fireEvent.click(submit());

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    // Trimmed, because a copy-paste brings whitespace with it. The password is
    // not: spaces at its edges are part of it.
    expect(JSON.parse(init.body)).toEqual({
      username: 'vakthavande',
      password: PASSWORD,
      token: 'nyckel',
    });
  });

  it('confirms in a way that leads to the login prompt', async () => {
    render(<AdminSetupForm tokenRequired />);
    fill({ token: 'nyckel', username: 'vakthavande', password: PASSWORD, confirm: PASSWORD });
    fireEvent.click(submit());

    expect(await screen.findByText('Klart')).toBeInTheDocument();
    // A full navigation, not a client-side push: the next request has to reach
    // the proxy for the browser to be asked for the credentials.
    expect(screen.getByRole('link', { name: /systemstatus/ })).toHaveAttribute('href', '/stats');
  });

  it('shows the server its own words when it refuses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Fel installationsnyckel.' }),
    });

    render(<AdminSetupForm tokenRequired />);
    fill({ token: 'fel', username: 'vakthavande', password: PASSWORD, confirm: PASSWORD });
    fireEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('Fel installationsnyckel.');
    expect(screen.queryByText('Klart')).not.toBeInTheDocument();
  });

  it('says something useful when the request never lands', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

    render(<AdminSetupForm tokenRequired />);
    fill({ token: 'nyckel', username: 'vakthavande', password: PASSWORD, confirm: PASSWORD });
    fireEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('Servern svarade inte');
    expect(submit()).toBeEnabled();
  });
});
