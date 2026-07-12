export interface User {
  email: string | null;
  getIdToken(): Promise<string>;
}

interface Auth {
  user: User | null;
}

const auth: Auth = {
  user: readStoredUser(),
};
const listeners = new Set<(user: User | null) => void>();

export class GoogleAuthProvider {}

export function getAuth(): Auth {
  return auth;
}

export function onAuthStateChanged(authInstance: Auth, callback: (user: User | null) => void) {
  listeners.add(callback);
  queueMicrotask(() => callback(authInstance.user));
  return () => {
    listeners.delete(callback);
  };
}

export async function signInWithPopup(authInstance: Auth, _provider: GoogleAuthProvider) {
  const email = window.localStorage.getItem("scanveilAdminE2eEmail") ?? "kei.of.nakayama@gmail.com";
  const user = createUser(email);
  authInstance.user = user;
  window.localStorage.setItem("scanveilAdminE2eEmail", email);
  notifyAuthListeners(user);
  return { user };
}

export async function signOut(authInstance: Auth): Promise<void> {
  authInstance.user = null;
  window.localStorage.removeItem("scanveilAdminE2eEmail");
  notifyAuthListeners(null);
}

function readStoredUser(): User | null {
  const email = window.localStorage.getItem("scanveilAdminE2eEmail");
  const hasEmail = email !== null && email.length > 0;
  if (!hasEmail) {
    return null;
  }

  return createUser(email);
}

function createUser(email: string): User {
  return {
    email,
    async getIdToken() {
      return `e2e-token:${email}`;
    },
  };
}

function notifyAuthListeners(user: User | null): void {
  for (const listener of listeners) {
    listener(user);
  }
}
