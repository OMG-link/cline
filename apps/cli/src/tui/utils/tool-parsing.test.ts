import { describe, expect, it } from "vitest";
import { buildReadFilesKeys, extractFullOutputText, parseReadFilesInput } from "./tool-parsing";

describe("buildReadFilesKeys", () => {
	it("produces unique keys when the same path is read twice", () => {
		const info = parseReadFilesInput({
			files: [{ path: "/a/SKILL.md" }, { path: "/a/SKILL.md" }],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);

		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("produces unique keys for duplicate paths from the file_paths shape", () => {
		const info = parseReadFilesInput({
			file_paths: ["/a/SKILL.md", "/a/SKILL.md", "/b/SKILL.md"],
		});
		const keys = buildReadFilesKeys(info?.files ?? []);

		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("keeps distinct paths in unique keys", () => {
		const keys = buildReadFilesKeys([{ path: "/a.ts" }, { path: "/b.ts" }]);

		expect(new Set(keys).size).toBe(2);
	});

	it("returns no keys for an empty list", () => {
		expect(buildReadFilesKeys([])).toEqual([]);
	});
});

describe("extractFullOutputText", () => {
	it("extracts output from CommandExecutionResult objects", () => {
		expect(
			extractFullOutputText(
				[
					{ result: { output: "build ok", exitCode: 0, status: "completed" } },
				],
				"run_commands",
			),
		).toBe("build ok");
	});

	it("extracts output string from plain string results", () => {
		expect(extractFullOutputText([{ result: "plain output" }])).toBe("plain output");
	});

	it("handles null/undefined", () => {
		expect(extractFullOutputText(null)).toBeUndefined();
		expect(extractFullOutputText(undefined)).toBeUndefined();
	});
});
