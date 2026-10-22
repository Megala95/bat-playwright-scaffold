import { test, expect } from "@playwright/test";
import { isSafeFileRef } from "../../src/utils/logCorrection";
import { withinWindow, capToMostRecent } from "../../src/utils/analyzeSkillSignals";
import { classifyElement } from "../../src/utils/locatorCandidate";
import { parseLocatorFile } from "../../src/core/LocatorRepository";

/**
 * Unit coverage for pure logic that an independent architecture re-review
 * flagged as cheap to test and untested: log-correction's path-safety
 * check, analyze-skills' time-window/capping math, and the element
 * classifier. Runs in the "meta" project (no browser, no target app - see
 * playwright.config.ts).
 */
test.describe("isSafeFileRef @meta", () => {
  test("accepts realistic repo-relative paths", () => {
    expect(isSafeFileRef("output/dsl/testcases/TC-1042.dsl.json")).toBe(true);
    expect(isSafeFileRef("README.md")).toBe(true);
    expect(isSafeFileRef("src/core/BasePage.ts")).toBe(true);
  });

  test("rejects path traversal", () => {
    expect(isSafeFileRef("../../etc/passwd")).toBe(false);
    expect(isSafeFileRef("output/../../../etc/passwd")).toBe(false);
  });

  test("rejects absolute paths", () => {
    expect(isSafeFileRef("/etc/passwd")).toBe(false);
    expect(isSafeFileRef("C:\\Windows\\System32")).toBe(false);
  });

  test("rejects empty or whitespace-only input", () => {
    expect(isSafeFileRef("")).toBe(false);
  });
});

test.describe("withinWindow @meta", () => {
  test("null days means no filtering", () => {
    expect(withinWindow("2020-01-01T00:00:00.000Z", null)).toBe(true);
  });

  test("a recent timestamp is within a 30-day window", () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(withinWindow(recent, 30)).toBe(true);
  });

  test("an old timestamp is outside a 30-day window", () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(withinWindow(old, 30)).toBe(false);
  });
});

test.describe("capToMostRecent @meta", () => {
  test("leaves a short list untouched", () => {
    expect(capToMostRecent([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  test("keeps only the tail (most recent, assuming oldest-first input) when over the cap", () => {
    expect(capToMostRecent([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
});

test.describe("classifyElement @meta", () => {
  test("classifies common input types", () => {
    expect(classifyElement({ tag: "input", type: "text", id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("EditBox");
    expect(classifyElement({ tag: "input", type: "password", id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("EditBox");
    expect(classifyElement({ tag: "input", type: "date", id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("DatePicker");
    expect(classifyElement({ tag: "input", type: "checkbox", id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("Checkbox");
  });

  test("classifies select, button (by tag or role), and links", () => {
    expect(classifyElement({ tag: "select", type: null, id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("Dropdown");
    expect(classifyElement({ tag: "button", type: null, id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("Button");
    expect(classifyElement({ tag: "div", type: null, id: null, name: null, ariaLabel: null, role: "button", text: null })).toBe("Button");
    expect(classifyElement({ tag: "a", type: null, id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("Link");
  });

  test("falls back to ReadOnlyField for anything unrecognized", () => {
    expect(classifyElement({ tag: "span", type: null, id: null, name: null, ariaLabel: null, role: null, text: null })).toBe("ReadOnlyField");
  });
});

test.describe("parseLocatorFile @meta", () => {
  test("accepts a well-formed locator file", () => {
    const file = parseLocatorFile({
      app: "TestApp",
      page: "login",
      elements: {
        usernameField: {
          label: "Username",
          elementClass: "EditBox",
          primary: { strategy: "id", value: "username" },
          fallbacks: [{ strategy: "getByRole", role: "textbox", name: "Username" }],
        },
      },
    });
    expect(file.page).toBe("login");
  });

  test("rejects the old colon-packed getByRole shape this project used to ship", () => {
    // This is exactly the shape a previous version of login.locators.json
    // had ({ strategy: "getByRole", value: "button:Sign In" }) - an
    // architecture review found that LoginPage.ts's `as any` cast let this
    // slip past TypeScript entirely. parseLocatorFile() is the runtime
    // backstop that catches it regardless of any cast at the call site.
    expect(() =>
      parseLocatorFile({
        app: "TestApp",
        page: "login",
        elements: {
          signInButton: {
            label: "Sign In",
            elementClass: "Button",
            primary: { strategy: "getByRole", value: "button:Sign In" },
            fallbacks: [],
          },
        },
      })
    ).toThrow(/doesn't match the expected shape/);
  });

  test("rejects a file missing required top-level fields", () => {
    expect(() => parseLocatorFile({ elements: {} })).toThrow();
    expect(() => parseLocatorFile(null)).toThrow();
    expect(() => parseLocatorFile("not an object")).toThrow();
  });

  test("rejects an elementClass that isn't one of ElementClass's values", () => {
    // A September 2026 independent re-review found that an earlier version
    // of this validator only checked `elementClass` was *a string*, not a
    // *valid* one - a typo like "TextBox" (vs. the real "EditBox") sailed
    // through parseLocatorFile() and only surfaced later as a confusing
    // `TypeError: Cannot read properties of undefined` deep inside
    // ElementTypes.ts's assertActionAllowed(). This reproduces that typo.
    expect(() =>
      parseLocatorFile({
        app: "TestApp",
        page: "login",
        elements: {
          usernameField: {
            label: "Username",
            elementClass: "TextBox", // not a real ElementClass value
            primary: { strategy: "id", value: "username" },
            fallbacks: [],
          },
        },
      })
    ).toThrow(/doesn't match the expected shape/);
  });

  test("rejects a getByRole candidate with a role Playwright doesn't recognize", () => {
    // Same category of gap as above, for the other bare-string field:
    // `role` was checked to be *a string* but not a *valid ARIA role*, so
    // `getByRole()` needed `role as any` to compile, papering over exactly
    // this kind of typo instead of catching it at load time.
    expect(() =>
      parseLocatorFile({
        app: "TestApp",
        page: "login",
        elements: {
          signInButton: {
            label: "Sign In",
            elementClass: "Button",
            primary: { strategy: "getByRole", role: "buton", name: "Sign In" }, // typo'd role
            fallbacks: [],
          },
        },
      })
    ).toThrow(/doesn't match the expected shape/);
  });
});
