/**
 * OpenAPI spec for the gateway. Served at GET /api/gateway/spec with the
 * request's origin as server URL so agents know exactly what to send.
 */
const SERVER_PLACEHOLDER = '__SERVER_URL__';

export const OPENAPI_SPEC_YAML = `openapi: 3.1.0
info:
  title: Wooblay Secure Gateway
  description: |
    Execute any action securely through Wooblay's three-layer security moat.
    Every action passes through policy evaluation, scope boundaries, pre-execution
    simulation, and ephemeral container execution. Credentials are never exposed —
    they're resolved from the vault at execution time and destroyed after.

    There is no fixed action list. Any action can be executed — provide the action
    name (for policy matching and audit), the command to run, and which provider's
    credentials to use. Wooblay handles the rest.

    **For OpenAI GPT Actions**: Import this spec as a custom action. Paste your
    Wooblay API key (starts with wbl_ak_) in the authentication section.

    **For Claude MCP / LangChain / any agent**: Use the Bearer token auth with
    your Wooblay API key.
  version: 1.0.0
  contact:
    name: Wooblay
    url: https://wooblay.com

servers:
  - url: __SERVER_URL__
    description: Your Wooblay gateway (use the URL this spec was downloaded from)

security:
  - apiKey: []

paths:
  /api/gateway/execute:
    post:
      operationId: executeAction
      summary: Execute a secure action
      description: |
        Execute any action through Wooblay's secure gateway. The action goes through:
        1. Policy evaluation (org-level rules)
        2. Scope boundary check (per-connection allowed/blocked targets)
        3. Pre-execution simulation (dry-run, API check, or evidence collection)
        4. Ephemeral secure execution (Docker container with injected credentials)

        The agent never sees the credentials. They're resolved from the vault,
        injected into an ephemeral container, and destroyed after execution.

        Any action name is accepted — there is no fixed list. The action name is
        used for policy matching and audit trail. Provide the command to run and
        which provider's credentials to inject.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - action
                - params
              properties:
                action:
                  type: string
                  description: |
                    Action name (any string). Used for policy matching and audit trail.
                    Examples: deploy:staging, db:migrate, notification:send
                params:
                  type: object
                  description: |
                    Parameters for the action. For generic execution, provide:
                    - command (string): The command to run in the ephemeral container
                    - provider (string): Which connection's credentials to inject
                    - image (string, optional): Docker image to use (default node:20-slim)
                    - env (object, optional): Additional environment variables
                  additionalProperties: true
      responses:
        '200':
          description: Action executed successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    type: object
                    properties:
                      stdout:
                        type: string
                      stderr:
                        type: string
                      exitCode:
                        type: integer
                      containerId:
                        type: string
                      durationMs:
                        type: integer
                      description:
                        type: string
                  simulation:
                    type: object
                    nullable: true
        '400':
          description: Missing required parameters
        '401':
          description: Authentication required
        '403':
          description: Denied by policy, scope boundary, or simulation failure
        '404':
          description: No active connection found for the specified provider
        '502':
          description: Secure execution failed

  /api/gateway/capabilities:
    get:
      operationId: getCapabilities
      summary: Get connected providers and usage info
      description: Returns which providers the org has connected. Use your API key.
      responses:
        '200':
          description: Connected providers and usage info
        '401':
          description: Authentication required

components:
  securitySchemes:
    apiKey:
      type: http
      scheme: bearer
      description: Wooblay API key (starts with wbl_ak_). Create one in Setup > API Keys.
`;

export function getGatewaySpecYaml(serverUrl: string): string {
  return OPENAPI_SPEC_YAML.split(SERVER_PLACEHOLDER).join(serverUrl);
}
