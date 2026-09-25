export function SectionHero(props: { image: string; eyebrow: string; title: string; subtitle: string }) {
  const { eyebrow, title, subtitle } = props;
  return (
    <div className="section-hero" role="banner">
      <div className="section-hero-code" aria-hidden="true">01001101 10110100 01101001 00110110 11010010 01011010 10100110 01101001</div>
      <div className="section-hero-overlay" />
      <div className="section-hero-content">
        <div className="section-hero-eyebrow">{eyebrow}</div>
        <h2 className="section-hero-title">{title}</h2>
        <p className="section-hero-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}
