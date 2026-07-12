export interface FirebaseOptions {
  authDomain?: string;
  projectId?: string;
}

export function initializeApp(_options: FirebaseOptions): { name: string } {
  return { name: "scanveil-admin-e2e" };
}
