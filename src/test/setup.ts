// Vitest global setup: jest-dom matchers (toBeInTheDocument, toBeDisabled, …)
// and Testing Library auto-cleanup between tests.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
	cleanup();
});
