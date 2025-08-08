import "./header.scss";

interface NavLink {
  label: string;
  href: string;
}

interface HeaderProps {
  title: { stat: string; trak: string; sports: string };
  navLinks: NavLink[];
  allLeaguesLink: NavLink;
}

const Header = ({ title, navLinks, allLeaguesLink }: HeaderProps) => {
  return (
    <header className="position-fixed top-0 start-0 w-100 py-3 px-4 d-flex align-items-center justify-content-between">
      {/* Website Title */}
      <h1 className="m-0 title">
        {/* Better: use Link component for SPA routing instead of <a> */}
        <a href="/" aria-label="Homepage">
          <span className="stat-text">{title.stat}</span>
          <span className="trak-text">{title.trak}</span>
          <span className="sports-text">{title.sports}</span>
        </a>
      </h1>

      {/* Centered Navigation Links */}
      <nav aria-label="Main navigation">
        <ul className="nav justify-content-center">
          {navLinks.map((link) => (
            <li className="nav-item" key={link.href}>
              <a href={link.href} className="nav-link">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* All Leagues Link */}
      <div className="allLeagues">
        <a href={allLeaguesLink.href} className="nav-link px-3 py-2">
          {allLeaguesLink.label}
        </a>
      </div>
    </header>
  );
};

export default Header;
