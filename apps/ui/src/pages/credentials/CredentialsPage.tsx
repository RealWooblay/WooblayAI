/**
 * Credentials — manage connection credentials only (no sensing UI).
 * Same key can be used for execution and/or referenced by Sensors.
 */

import { ConnectionsPage } from '../connections/ConnectionsPage.tsx';

export function CredentialsPage() {
  return <ConnectionsPage credentialsOnly />;
}
