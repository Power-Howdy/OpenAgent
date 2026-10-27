let transcript: unknown = []

export function setTranscript(messages: unknown): void {
  transcript = messages
}

export function getTranscript(): unknown {
  return transcript
}
