export default function Home() {
  return (
    <div className="home-hero">
      <h1>Welcome to Yieldly</h1>
      <p className="hero-subtitle">Your intelligent portfolio companion</p>
      <div className="coming-soon-container">
        <div className="chat-preview">
          <div className="chat-watermark">Coming Soon</div>
          <div className="chat-placeholder">
            <div className="chat-message assistant">
              <p>Hello! I&apos;m your AI portfolio assistant. Soon you&apos;ll be able to ask me questions like:</p>
            </div>
            <div className="chat-message user">
              <p>&quot;What&apos;s my total dividend income this year?&quot;</p>
            </div>
            <div className="chat-message user">
              <p>&quot;Show me my best performing stocks&quot;</p>
            </div>
            <div className="chat-message user">
              <p>&quot;Analyze my portfolio diversification&quot;</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
