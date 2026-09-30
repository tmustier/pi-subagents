import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeAgent, makeMinimalCtx } from "../support/helpers.ts";
import {
	available, installSingleExecutionHooks, makeExecutor, mockPi, readCall, tempDir,
} from "../support/single-execution-fixture.ts";
import { buildAsyncRunnerSteps } from "../../src/runs/background/async-execution.ts";

const collision = { provider: "openrouter", id: "openai/gpt-6.1-sol", fullId: "openrouter/openai/gpt-6.1-sol" };
const direct = { provider: "openai", id: "gpt-6.1-sol", fullId: "openai/gpt-6.1-sol" };

describe("provider qualification at launch", { skip: !available ? "Pi packages unavailable" : undefined }, () => {
	installSingleExecutionHooks();

	it("threads the full host registry through foreground and async launches without starting a colliding model", async () => {
		const ctx = {
			...makeMinimalCtx(tempDir),
			model: { provider: "openai", id: "parent" },
			modelRegistry: { getAvailable: () => [collision], getAll: () => [direct, collision] },
		};
		for (const async of [false, true]) {
			for (const explicit of [false, true]) {
				const agent = makeAgent("worker", explicit ? {} : { model: "openai/gpt-6.1-sol:high" });
				const result = await makeExecutor([agent]).execute(`provider-${async}-${explicit}`, {
					agent: "worker", task: "Reply with a marker", async,
					...(explicit ? { model: "openai/gpt-6.1-sol:high" } : {}),
				}, undefined, undefined, ctx);
				assert.equal(result.isError, true);
				assert.match(result.content[0]?.text ?? "", /Unknown subagent model 'openai\/gpt-6.1-sol:high'/);
			}
		}
		assert.equal(mockPi.callCount(), 0);
	});

	it("keeps configured and explicit chain models qualified with an unavailable provider snapshot", () => {
		for (const explicit of [false, true]) {
			let error: string | undefined;
			try {
				error = buildAsyncRunnerSteps("provider-chain", {
					chain: [{ agent: "worker", task: "Reply", ...(explicit ? { model: "openai/gpt-6.1-sol:high" } : {}) }],
					agents: [makeAgent("worker", explicit ? {} : { model: "openai/gpt-6.1-sol:high" })],
					ctx: { cwd: tempDir, currentModelProvider: "openai" },
					availableModels: [collision], registeredProviders: ["openai", "openrouter"],
					maxSubagentDepth: 0,
				}).error;
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
			}
			assert.match(error ?? "", /Unknown subagent model 'openai\/gpt-6.1-sol:high'/);
		}
		assert.equal(mockPi.callCount(), 0);
	});

	it("launches the available direct provider with its thinking suffix rather than the colliding raw id", async () => {
		mockPi.onCall({ output: "direct-marker", model: "gpt-6.1-sol" });
		const ctx = {
			...makeMinimalCtx(tempDir),
			modelRegistry: { getAvailable: () => [direct, collision], getAll: () => [direct, collision] },
		};
		const result = await makeExecutor([makeAgent("worker")]).execute("provider-direct", {
			agent: "worker", task: "Reply with a marker", model: "openai/gpt-6.1-sol:high", async: false,
		}, undefined, undefined, ctx);
		assert.equal(result.isError, undefined, result.content[0]?.text);
		assert.equal(mockPi.callCount(), 1);
		assert.equal(readCall(0).launch?.model, "openai/gpt-6.1-sol:high");
	});
});
