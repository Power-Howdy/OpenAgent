export function previewText(text: string, max = 2000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… truncated ${text.length - max} characters`
}
