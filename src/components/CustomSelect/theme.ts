export type Theme = {
  styles: {
    container: () => Record<string, unknown>
    option: (props: { isFocused: boolean }) => Record<string, unknown>
    focusIndicator: () => Record<string, unknown>
    label: (props: { isFocused: boolean; isSelected: boolean }) => Record<string, unknown>
    selectedIndicator: () => Record<string, unknown>
    highlightedText: (props?: { isHighlighted?: boolean }) => Record<string, unknown>
  }
}
