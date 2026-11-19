export const byId = (id) => document.getElementById(id);

export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export const number = (key, label, value, change, min, max, step = 0.001) => ({
  key,
  label,
  value,
  change,
  min,
  max,
  step,
  type: "number",
});

export const choice = (key, label, value, change, options) => ({
  key,
  label,
  value,
  change,
  options,
  type: "select",
});

let labelCount = 0;

export function fields(container, definitions) {
  const existing = new Map(
    [...container.children].map((element) => [element.dataset.key, element]),
  );
  const keys = new Set(definitions.map(({ key }) => key));
  for (const [key, element] of existing) {
    if (!keys.has(key)) element.remove();
  }
  definitions.forEach((field, index) => {
    let label = existing.get(field.key);
    if (!label) {
      label = node("label", "field");
      label.dataset.key = field.key;
      const title = node("span", "", field.label);
      title.id = `editor-field-${++labelCount}`;
      label.append(title);
      const input = node(
        field.type === "select" || field.type === "textarea"
          ? field.type
          : "input",
      );
      input.setAttribute("aria-labelledby", title.id);
      if (input.tagName === "INPUT") input.type = field.type;
      input.addEventListener("change", () => {
        const current = input.definition;
        const value =
          current.type === "number"
            ? input.valueAsNumber
            : current.type === "checkbox"
              ? input.checked
              : input.value;
        if (current.type === "number" && !Number.isFinite(value))
          input.value = current.value;
        else current.change(value);
      });
      label.append(input);
    }
    if (container.children[index] !== label)
      container.insertBefore(label, container.children[index] ?? null);
    const input = label.lastElementChild;
    input.definition = field;
    label.classList.toggle(
      "wide",
      field.type === "textarea" || field.wide === true,
    );
    for (const attribute of ["min", "max", "step", "rows", "maxLength"]) {
      if (field[attribute] !== undefined) input[attribute] = field[attribute];
    }
    if (field.type === "select") {
      for (const [index, [value, title]] of field.options.entries()) {
        let option = input.options[index];
        if (!option) input.append((option = node("option")));
        option.value = value;
        if (option.textContent !== title) option.textContent = title;
      }
      input.length = field.options.length;
    }
    if (field.type === "checkbox") input.checked = field.value;
    else {
      const value =
        field.type === "number"
          ? String(Number(field.value.toFixed(3)))
          : String(field.value);
      if (input.value !== value) input.value = value;
    }
    input.disabled = Boolean(field.disabled);
  });
}
