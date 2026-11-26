/**
 * Shows why a form cannot be saved: scrolls to the field, lights it up and
 * writes the reason right under it ("Compila questo campo").
 *
 * Fields are found by `data-field="<key>"` on the wrapping label, or by the
 * `name` attribute of the input inside the form.
 */
export interface FieldProblem { field: string; message: string; label?: string; }

const INVALID_CLASS = 'is-invalid';
const ERROR_CLASS = 'field-error';

export function clearFieldProblems(form: HTMLElement | null | undefined): void {
  if (!form) return;
  form.querySelectorAll(`.${INVALID_CLASS}`).forEach(element => element.classList.remove(INVALID_CLASS));
  form.querySelectorAll(`.${ERROR_CLASS}`).forEach(element => element.remove());
}

/** Highlights every problem and brings the user to the first one. */
export function showFieldProblems(form: HTMLElement | null | undefined, problems: FieldProblem[]): void {
  if (!form || !problems.length) return;
  clearFieldProblems(form);
  let first: HTMLElement | null = null;
  for (const problem of problems) {
    const host = findFieldHost(form, problem.field);
    if (!host) continue;
    host.classList.add(INVALID_CLASS);
    const note = document.createElement('span');
    note.className = ERROR_CLASS;
    note.setAttribute('role', 'alert');
    note.textContent = problem.message;
    host.appendChild(note);
    // The highlight disappears as soon as the user fixes the field.
    const reset = () => { host.classList.remove(INVALID_CLASS); note.remove(); };
    host.addEventListener('input', reset, { once: true });
    host.addEventListener('click', event => { if ((event.target as HTMLElement).closest('.form-dropdown-option, .formation-picker-option')) reset(); });
    first ??= host;
  }
  if (!first) return;
  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const focusable = first.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea, select, button');
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 350);
}

function findFieldHost(form: HTMLElement, field: string): HTMLElement | null {
  const byData = form.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (byData) return byData;
  const input = form.querySelector<HTMLElement>(`[name="${field}"]`);
  return (input?.closest('label, fieldset') as HTMLElement | null) ?? input;
}
