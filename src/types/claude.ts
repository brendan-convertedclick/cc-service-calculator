export interface ClaudePrompt {
  id: string;
  label: string;
  build: () => string;
}
