# Plan: Add Agent-to-Agent Contract Management Showcase

## Context
The user wants to improve the "Threat Analyst" scenario to better showcase agent-to-agent protocol and contract management. Currently, the simulator lacks explicit visual or functional indicators for JSON schemas or agent contracts, which are critical for robust agent-to-agent communication.

## Proposed Changes
1. **Enhance `NodeConfig`**: Add `inputSchema` to `NodeConfig` in `src/types/simulator.ts` to allow nodes to define expected input contracts.
2. **Update `SimulatorNode`**:
   - Add a visual indicator (e.g., a small "JSON" badge or icon) when a node has a defined `outputSchema` or `inputSchema`.
   - This provides immediate visual feedback that a contract is in place.
3. **Update `GradingEngine`**:
   - Add a bonus for matching `outputSchema` of a source node to the `inputSchema` of a target node (contract validation).
   - This incentivizes users to actually define and align these schemas.
4. **Update `Threat Analyst` Scenario**:
   - Update the optimal solution in `src/data/answers.ts` to include these schemas, demonstrating the "contract-first" design.
   - Add a hint in the scenario description about "Contract-First Design".

## Verification
- Verify that the "JSON" badge appears on nodes with schemas.
- Verify that the grading engine correctly identifies and rewards schema alignment between connected nodes.
- Ensure the "Threat Analyst" optimal solution passes all thresholds with the new schema-based bonuses.
