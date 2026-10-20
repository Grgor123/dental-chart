import { useCallback, useEffect, useRef, useState } from 'react';

// The browser's own speech recognition (Web Speech API — Chrome and Edge;
// Firefox has none). In Chrome the audio is recognised by Google's servers.
// Kept behind this small hook so the engine can be swapped for a cloud model
// later without touching the chart page.
//
// Listens continuously while switched on: the browser ends a session after a
// pause, so it is restarted until stop() is called.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Brskalnik ne dovoli uporabe mikrofona — dovolite ga v naslovni vrstici.',
  'service-not-allowed': 'Brskalnik ne dovoli uporabe mikrofona — dovolite ga v naslovni vrstici.',
  'audio-capture': 'Mikrofon ni najden.',
  network: 'Prepoznavanje govora potrebuje internetno povezavo.',
};

/** onFinal gets the recogniser's alternatives for one phrase, best guess first. */
export function useSpeechRecognition(onFinal: (alternatives: string[]) => void, lang = 'sl-SI') {
  const supported = recognitionConstructor() !== null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  const stop = useCallback(() => {
    wantRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    setError(null);
    wantRef.current = true;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    // Several guesses per phrase — the caller picks the one that makes sense
    // (e.g. the one that still contains the tooth number).
    rec.maxAlternatives = 5;
    rec.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const alternatives: string[] = [];
          for (let a = 0; a < result.length; a++) {
            const t = result[a]?.transcript?.trim();
            if (t && !alternatives.includes(t)) alternatives.push(t);
          }
          if (alternatives.length) onFinalRef.current(alternatives);
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(ERROR_TEXT[e.error] ?? `Napaka prepoznavanja govora: ${e.error}`);
      if (e.error in ERROR_TEXT) wantRef.current = false;
    };
    rec.onend = () => {
      setInterim('');
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          // fall through: stopped
        }
      }
      setListening(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Prepoznavanja govora ni bilo mogoče zagnati.');
    }
  }, [lang]);

  // Stop when the page goes away.
  useEffect(
    () => () => {
      wantRef.current = false;
      recognitionRef.current?.abort();
    },
    []
  );

  return { supported, listening, interim, error, start, stop };
}
