// Backward-compat: re-export everything from operation.ts
export {
  type OperationSource as IncidentSource,
  type OperationPriority as IncidentPriority,
  type OperationStatus as IncidentStatus,
  type OperationIntent as IncidentIntent,
  type Operation as Incident,
  type RoutingStatus,
  type Operation,
  type OperationSource,
  type OperationPriority,
  type OperationStatus,
  type OperationIntent,
  type GitHubSensorConfig,
  DEFAULT_GITHUB_SENSOR_CONFIG,
} from './operation.js';
