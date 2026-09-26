export const baseURL = "";

type AuthStatus = {
    setupRequired?: boolean;
    authenticated?: boolean;
    user?: { id: string; username: string } | null;
};

type ApiData = { error?: string; user?: { id: string; username: string } };

export const authClient = {
    async getSession() {
        const response = await fetch(`${baseURL}/api/auth/status`, { credentials: "same-origin" });
        if (!response.ok) {
            return { data: null, error: new Error("Unable to read the login session") };
        }
        const data = (await response.json()) as AuthStatus;
        return { data: data.authenticated ? { user: data.user } : null, error: null };
    },
};

async function request(path: string, body?: Record<string, unknown>) {
    const response = await fetch(`${baseURL}${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as ApiData;
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}
/**
 * @returns Check if the user is logged in
 */
export async function isLoggedIn() {
    const session = await authClient.getSession();
    return session.data !== null;
}

/**
 * @param username Username
 * @param password Password
 * @param remember Remember Me
 */
export async function login(username: string, password: string, remember: boolean = true) {
    void remember;
    const data = await request("/api/auth/login", { username, password });
    window.dispatchEvent(new CustomEvent("kuma-auth-changed", { detail: data.user }));
    return data.user;
}

/**
 * @param token Token
 */
export async function verifyTotp(token: string) {
    void token;
    throw new Error("Two-factor authentication is not available in this Worker version");
}

/**
 * @param onSuccess
 */
export async function logout(onSuccess = () => {}) {
    await request("/api/auth/logout");
    window.dispatchEvent(new CustomEvent("kuma-auth-changed"));
    onSuccess();
}
