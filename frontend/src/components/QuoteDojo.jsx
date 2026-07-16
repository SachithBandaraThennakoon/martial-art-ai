import { useEffect, useState } from "react";
import { trainingQuotes } from "../data/trainingQuotes";

const ROTATION_INTERVAL = 7000;

export default function QuoteDojo({ quotes = trainingQuotes }) {
  const [activeQuote, setActiveQuote] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused || quotes.length < 2) return undefined;
    const timer = window.setInterval(
      () => setActiveQuote((current) => (current + 1) % quotes.length),
      ROTATION_INTERVAL
    );
    return () => window.clearInterval(timer);
  }, [isPaused, quotes.length]);

  if (!quotes.length) return null;

  const quote = quotes[activeQuote % quotes.length];
  const isLongQuote = quote.quote.length > 90;

  return (
    <aside className={`hero-quote ${isPaused ? "is-paused" : ""}`} aria-label="Wisdom from martial arts masters">
      <header className="hero-quote__header">
        <div className="hero-quote__journal">
          <span aria-hidden="true">XMA / {String(activeQuote + 1).padStart(2, "0")}</span>
          <div><strong>Wisdom archive</strong><small>Words that shape the practice</small></div>
        </div>
        <button
          aria-label={`${isPaused ? "Play" : "Pause"} quote rotation`}
          aria-pressed={isPaused}
          className="hero-quote__play"
          onClick={() => setIsPaused((paused) => !paused)}
          type="button"
        >
          <i aria-hidden="true" /> {isPaused ? "Play" : "Pause"}
        </button>
      </header>

      <div className={`hero-quote__stage ${isLongQuote ? "is-long" : ""}`} key={activeQuote}>
        <div className="hero-quote__meta">
          <span>Master’s note</span>
          <span>{quote.discipline}</span>
        </div>
        <span className="hero-quote__mark" aria-hidden="true">“</span>
        <blockquote>{quote.quote}</blockquote>
        <div className="hero-quote__author">
          <span aria-hidden="true">{quote.mark}</span>
          <div><small>Words by</small><strong>{quote.author}</strong></div>
          <i aria-hidden="true" />
        </div>
      </div>

      <nav className="hero-quote__navigation" aria-label="Choose a quote">
        {quotes.map((item, index) => (
          <button
            aria-label={`Show quote by ${item.author}`}
            aria-pressed={index === activeQuote}
            className={index === activeQuote ? "is-active" : ""}
            key={`${item.author}-${index}`}
            onClick={() => setActiveQuote(index)}
            type="button"
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{item.mark}</strong>
            <i aria-hidden="true" />
          </button>
        ))}
      </nav>
    </aside>
  );
}
