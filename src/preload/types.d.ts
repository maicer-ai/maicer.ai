export {};
declare global {
  interface Window {
    voiceCode: {
      health(): Promise<{ running: boolean; model?: string }>;
      setupStatus(): Promise<{ ollama: boolean; model: boolean; whisper: boolean; qwenAsset: boolean; ready: boolean }>;
      bootstrapRuntime(): Promise<{ ollama: boolean; model: boolean; whisper: boolean; qwenAsset: boolean; ready: boolean }>;
      hideOverlay(): Promise<boolean>;
      readSelection(): Promise<{ text: string; source: string }>;
      checkLimit(): Promise<{ allowed: boolean; used: number; limit: number; tier: 'free' | 'pro'; warning?: string }>;
      recordCompletion(output: string, seconds: number): Promise<{ used: number; limit: number; metrics: { functions: number; lines: number; seconds: number } }>;
      todayMetrics(): Promise<{ functions: number; lines: number; seconds: number }>;
      transcribe(audio: ArrayBuffer): Promise<{ transcript: string; status: string }>;
      generate(input: { transcript: string; context: string; outsideIde: boolean; requestId?: number }): Promise<boolean>;
      copy(text: string): Promise<boolean>;
      typeOutput(text: string): Promise<{ inserted: boolean; reason?: string }>;
      typingStatus(): Promise<{ available: boolean; platform: string }>;
      cancelGeneration(requestId: number): Promise<boolean>;
      openCheckout(): Promise<boolean>;
      hasLicense(): Promise<boolean>;
      setLicense(token: string): Promise<boolean>;
      listSessions(): Promise<Array<{ id: string; title: string; transcript: string; output: string; context: string; createdAt: number }>>;
      saveSession(session: { title: string; transcript: string; output: string; context: string }): Promise<{ id: string; createdAt: number }>;
      onChunk(callback: (chunk: { requestId?: number; chunk: string }) => void): () => void;
      onComplete(callback: (result: { requestId?: number; typed: boolean }) => void): () => void;
      onOverlayOpened(callback: () => void): () => void;
      onHotkey(callback: () => void): () => void;
      onSetupProgress(callback: (progress: { phase: string; percent: number; detail: string }) => void): () => void;
    };
  }
}