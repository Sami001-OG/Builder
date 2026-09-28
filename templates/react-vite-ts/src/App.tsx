export default function App() {
  return (
    <main className="page">
      <nav className="nav">
        <strong>New App</strong>
        <span className="spacer" />
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
      </nav>
      <section className="hero">
        <h1>Build something great</h1>
        <p>Created with Builder. Ask the AI agent to extend this page.</p>
      </section>
      <section id="features" className="grid">
        <div className="card"><h3>Fast</h3><p>Vite + React + TypeScript.</p></div>
        <div className="card"><h3>Local</h3><p>Runs on your machine.</p></div>
        <div className="card"><h3>Yours</h3><p>Plain files on disk + Git.</p></div>
      </section>
      <footer className="footer">© New App</footer>
    </main>
  );
}
