function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur && typeof cur === 'object' && key in cur) {
      return (cur as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) return ''

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }

  return JSON.stringify(value, null, 2)
}

/**
 * Replace {{key}} or {{nested.key}} placeholders in a template string.
 * Missing keys become empty strings.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = getByPath(vars, key)
    return stringifyTemplateValue(value)
  })
}
