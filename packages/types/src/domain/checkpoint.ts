export interface Checkpoint {
  id: string;
  toolName: string;
  scope: string;
  path: string;
  metadata: string | null; // JSON
  createdAt: string;
}
