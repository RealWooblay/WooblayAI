/**
 * TaskManager — placeholder for MCP Tasks lifecycle management (v1.5 readiness).
 *
 * In the future, this will manage:
 * - Task creation and lifecycle tracking
 * - Tool call <-> Task association
 * - Progress reporting via MCP task notifications
 * - Session and conversation context management
 *
 * TODO: Implement task creation from MCP task/start notifications
 * TODO: Map incoming tool calls to their parent task
 * TODO: Track task state transitions (running -> completed / failed)
 * TODO: Report task progress back via MCP server notifications
 * TODO: Support task cancellation via MCP task/cancel
 * TODO: Persist task history for audit trail
 */
export class TaskManager {
  // TODO: Add task storage (in-memory Map for now, backed by Gate later)
  // TODO: Add active task tracking
  // TODO: Add session correlation

  /**
   * Initialize the TaskManager.
   * Currently a no-op; will set up listeners and storage in v1.5.
   */
  async initialize(): Promise<void> {
    // TODO: Register MCP notification handlers for task lifecycle
    // TODO: Restore any in-flight tasks from Gate on startup
  }

  /**
   * Shut down the TaskManager gracefully.
   */
  async shutdown(): Promise<void> {
    // TODO: Mark in-flight tasks as interrupted
    // TODO: Flush any pending state to Gate
  }
}
