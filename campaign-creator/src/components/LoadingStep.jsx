export default function LoadingStep({ message }) {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
      <div className="spinner" />
      <div style={{ fontSize: 17, fontWeight: 700, color: '#1a2a3a', marginBottom: 8 }}>
        {message}
      </div>
      <div style={{ fontSize: 13, color: '#7a8a9a' }}>
        Building keywords · ad copy · sitelinks · negatives · extensions...
      </div>
    </div>
  );
}
