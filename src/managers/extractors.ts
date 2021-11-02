export function extractSelectorValue(selector?: string) {
  const attrValue = selector?.split('=')[1]
  return attrValue?.replaceAll(/(\"|'|[|])/, '').trim() || ''
}
