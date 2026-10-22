/**
 * Item 2.2 (Solution Approach): "the class determines valid actions".
 *
 * Every locator in the shared repository is tagged with one of these element
 * classes. BasePage.act() looks up the class before performing an action, so
 * a generated script can never (for example) try to .selectOption() on a
 * plain read-only field - it fails fast with a clear error instead of a
 * confusing Playwright timeout three layers down.
 *
 * Extend this list as new UI patterns show up across Cisco apps beyond CCW
 * (Support Ask: "per-app validation beyond CCW").
 */
export enum ElementClass {
  EditBox = "EditBox",
  DatePicker = "DatePicker",
  Dropdown = "Dropdown",
  Checkbox = "Checkbox",
  Button = "Button",
  Link = "Link",
  ReadOnlyField = "ReadOnlyField",
}

export type ElementAction =
  | "fill"
  | "clear"
  | "pickDate"
  | "selectOption"
  | "check"
  | "uncheck"
  | "click"
  | "assertText"
  | "assertVisible";

/**
 * The valid-actions table referenced by item 2.2. Keep this list, not tribal
 * knowledge, as the source of truth for "what can you do with a Dropdown".
 */
export const ELEMENT_ACTIONS: Record<ElementClass, ElementAction[]> = {
  [ElementClass.EditBox]: ["fill", "clear", "assertText", "assertVisible"],
  [ElementClass.DatePicker]: ["pickDate", "assertText", "assertVisible"],
  [ElementClass.Dropdown]: ["selectOption", "assertText", "assertVisible"],
  [ElementClass.Checkbox]: ["check", "uncheck", "assertVisible"],
  [ElementClass.Button]: ["click", "assertVisible"],
  [ElementClass.Link]: ["click", "assertVisible"],
  [ElementClass.ReadOnlyField]: ["assertText", "assertVisible"],
};

export function assertActionAllowed(elementClass: ElementClass, action: ElementAction): void {
  if (!ELEMENT_ACTIONS[elementClass].includes(action)) {
    throw new Error(
      `Item 2.2 guard: "${action}" is not a valid action for element class "${elementClass}". ` +
        `Valid actions are: ${ELEMENT_ACTIONS[elementClass].join(", ")}.`
    );
  }
}
