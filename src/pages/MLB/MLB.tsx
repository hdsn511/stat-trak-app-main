import React, { useState, useEffect } from 'react';
import './mlb.scss';

interface Pick {
  id: number;
  player: string;
  stat: string;
  line: string;
  odds: string;
  confidence: 'High' | 'Medium' | 'Low';
  game: string;
}

interface NewsItem {
  id: number;
  title: string;
  summary: string;
  timestamp: string;
  image: string;
}

interface Team {
  id: number;
  name: string;
  city: string;
  abbreviation: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  league: 'American' | 'National';
  record: {
    wins: number;
    losses: number;
  };
}

const MLB: React.FC = () => {
  const [popularPicks, setPopularPicks] = useState<Pick[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    // Mock data - replace with actual API calls
    setPopularPicks([
      {
        id: 1,
        player: "Shohei Ohtani",
        stat: "Total Bases",
        line: "Over 1.5",
        odds: "-125",
        confidence: "High",
        game: "LAA vs HOU"
      },
      {
        id: 2,
        player: "Aaron Judge",
        stat: "Home Runs",
        line: "Over 0.5",
        odds: "+180",
        confidence: "Medium",
        game: "NYY vs TB"
      },
      {
        id: 3,
        player: "Mookie Betts",
        stat: "Hits",
        line: "Over 1.5",
        odds: "-110",
        confidence: "High",
        game: "LAD vs SD"
      },
      {
        id: 4,
        player: "Jacob deGrom",
        stat: "Strikeouts",
        line: "Over 7.5",
        odds: "-115",
        confidence: "High",
        game: "TEX vs SEA"
      },
      {
        id: 5,
        player: "Ronald Acuña Jr.",
        stat: "Stolen Bases",
        line: "Over 0.5",
        odds: "+140",
        confidence: "Medium",
        game: "ATL vs PHI"
      },
      {
        id: 6,
        player: "Freddie Freeman",
        stat: "RBIs",
        line: "Over 1.5",
        odds: "+120",
        confidence: "Low",
        game: "LAD vs SD"
      }
    ]);

    setNews([
      {
        id: 1,
        title: "Spring Training Preview: Top Storylines to Watch",
        summary: "As teams prepare for the upcoming season, several key storylines emerge from spring training camps.",
        timestamp: "3 hours ago",
        image: "/api/placeholder/200/120"
      },
      {
        id: 2,
        title: "Free Agency Update: Major Signings Still Available",
        summary: "Several high-profile free agents remain unsigned as spring training gets underway.",
        timestamp: "5 hours ago",
        image: "/api/placeholder/200/120"
      },
      {
        id: 3,
        title: "Hall of Fame Ballot Results: New Inductees Announced",
        summary: "The Baseball Hall of Fame welcomes new members in this year's class of inductees.",
        timestamp: "8 hours ago",
        image: "/api/placeholder/200/120"
      }
    ]);

    // Mock MLB teams data
    setTeams([
      // American League
      { id: 1, name: "Yankees", city: "New York", abbreviation: "NYY", logo: "/api/placeholder/60/60", primaryColor: "#132448", secondaryColor: "#C4CED4", league: "American", record: { wins: 99, losses: 63 } },
      { id: 2, name: "Astros", city: "Houston", abbreviation: "HOU", logo: "/api/placeholder/60/60", primaryColor: "#002D62", secondaryColor: "#EB6E1F", league: "American", record: { wins: 106, losses: 56 } },
      { id: 3, name: "Blue Jays", city: "Toronto", abbreviation: "TOR", logo: "/api/placeholder/60/60", primaryColor: "#134A8E", secondaryColor: "#1D2D5C", league: "American", record: { wins: 92, losses: 70 } },
      { id: 4, name: "Rays", city: "Tampa Bay", abbreviation: "TB", logo: "/api/placeholder/60/60", primaryColor: "#092C5C", secondaryColor: "#8FBCE6", league: "American", record: { wins: 99, losses: 63 } },
      { id: 5, name: "Red Sox", city: "Boston", abbreviation: "BOS", logo: "/api/placeholder/60/60", primaryColor: "#BD3039", secondaryColor: "#0C2340", league: "American", record: { wins: 78, losses: 84 } },
      { id: 6, name: "Guardians", city: "Cleveland", abbreviation: "CLE", logo: "/api/placeholder/60/60", primaryColor: "#E31937", secondaryColor: "#002B5C", league: "American", record: { wins: 92, losses: 70 } },
      { id: 7, name: "White Sox", city: "Chicago", abbreviation: "CWS", logo: "/api/placeholder/60/60", primaryColor: "#27251F", secondaryColor: "#C4CED4", league: "American", record: { wins: 81, losses: 81 } },
      { id: 8, name: "Tigers", city: "Detroit", abbreviation: "DET", logo: "/api/placeholder/60/60", primaryColor: "#0C2340", secondaryColor: "#FA4616", league: "American", record: { wins: 66, losses: 96 } },
      { id: 9, name: "Royals", city: "Kansas City", abbreviation: "KC", logo: "/api/placeholder/60/60", primaryColor: "#004687", secondaryColor: "#BD9B60", league: "American", record: { wins: 65, losses: 97 } },
      { id: 10, name: "Twins", city: "Minnesota", abbreviation: "MIN", logo: "/api/placeholder/60/60", primaryColor: "#002B5C", secondaryColor: "#D31145", league: "American", record: { wins: 87, losses: 75 } },
      { id: 11, name: "Angels", city: "Los Angeles", abbreviation: "LAA", logo: "/api/placeholder/60/60", primaryColor: "#BA0021", secondaryColor: "#003263", league: "American", record: { wins: 73, losses: 89 } },
      { id: 12, name: "Athletics", city: "Oakland", abbreviation: "OAK", logo: "/api/placeholder/60/60", primaryColor: "#003831", secondaryColor: "#EFB21E", league: "American", record: { wins: 60, losses: 102 } },
      { id: 13, name: "Mariners", city: "Seattle", abbreviation: "SEA", logo: "/api/placeholder/60/60", primaryColor: "#0C2C56", secondaryColor: "#005C5C", league: "American", record: { wins: 90, losses: 72 } },
      { id: 14, name: "Rangers", city: "Texas", abbreviation: "TEX", logo: "/api/placeholder/60/60", primaryColor: "#003278", secondaryColor: "#C0111F", league: "American", record: { wins: 90, losses: 72 } },
      { id: 15, name: "Orioles", city: "Baltimore", abbreviation: "BAL", logo: "/api/placeholder/60/60", primaryColor: "#DF4601", secondaryColor: "#000000", league: "American", record: { wins: 101, losses: 61 } },

      // National League
      { id: 16, name: "Braves", city: "Atlanta", abbreviation: "ATL", logo: "/api/placeholder/60/60", primaryColor: "#CE1141", secondaryColor: "#13274F", league: "National", record: { wins: 104, losses: 58 } },
      { id: 17, name: "Phillies", city: "Philadelphia", abbreviation: "PHI", logo: "/api/placeholder/60/60", primaryColor: "#E81828", secondaryColor: "#002D72", league: "National", record: { wins: 90, losses: 72 } },
      { id: 18, name: "Mets", city: "New York", abbreviation: "NYM", logo: "/api/placeholder/60/60", primaryColor: "#002D72", secondaryColor: "#FF5910", league: "National", record: { wins: 101, losses: 61 } },
      { id: 19, name: "Marlins", city: "Miami", abbreviation: "MIA", logo: "/api/placeholder/60/60", primaryColor: "#00A3E0", secondaryColor: "#EF3340", league: "National", record: { wins: 69, losses: 93 } },
      { id: 20, name: "Nationals", city: "Washington", abbreviation: "WSH", logo: "/api/placeholder/60/60", primaryColor: "#AB0003", secondaryColor: "#14225A", league: "National", record: { wins: 55, losses: 107 } },
      { id: 21, name: "Brewers", city: "Milwaukee", abbreviation: "MIL", logo: "/api/placeholder/60/60", primaryColor: "#FFC52F", secondaryColor: "#12284B", league: "National", record: { wins: 86, losses: 76 } },
      { id: 22, name: "Cardinals", city: "St. Louis", abbreviation: "STL", logo: "/api/placeholder/60/60", primaryColor: "#C41E3A", secondaryColor: "#FEDB00", league: "National", record: { wins: 93, losses: 69 } },
      { id: 23, name: "Cubs", city: "Chicago", abbreviation: "CHC", logo: "/api/placeholder/60/60", primaryColor: "#0E3386", secondaryColor: "#CC3433", league: "National", record: { wins: 83, losses: 79 } },
      { id: 24, name: "Reds", city: "Cincinnati", abbreviation: "CIN", logo: "/api/placeholder/60/60", primaryColor: "#C6011F", secondaryColor: "#000000", league: "National", record: { wins: 64, losses: 98 } },
      { id: 25, name: "Pirates", city: "Pittsburgh", abbreviation: "PIT", logo: "/api/placeholder/60/60", primaryColor: "#FDB827", secondaryColor: "#27251F", league: "National", record: { wins: 62, losses: 100 } },
      { id: 26, name: "Dodgers", city: "Los Angeles", abbreviation: "LAD", logo: "/api/placeholder/60/60", primaryColor: "#005A9C", secondaryColor: "#EF3E42", league: "National", record: { wins: 111, losses: 51 } },
      { id: 27, name: "Padres", city: "San Diego", abbreviation: "SD", logo: "/api/placeholder/60/60", primaryColor: "#2F241D", secondaryColor: "#FFC425", league: "National", record: { wins: 89, losses: 73 } },
      { id: 28, name: "Giants", city: "San Francisco", abbreviation: "SF", logo: "/api/placeholder/60/60", primaryColor: "#FD5A1E", secondaryColor: "#27251F", league: "National", record: { wins: 81, losses: 81 } },
      { id: 29, name: "Rockies", city: "Colorado", abbreviation: "COL", logo: "/api/placeholder/60/60", primaryColor: "#33006F", secondaryColor: "#C4CED4", league: "National", record: { wins: 68, losses: 94 } },
      { id: 30, name: "Diamondbacks", city: "Arizona", abbreviation: "ARI", logo: "/api/placeholder/60/60", primaryColor: "#A71930", secondaryColor: "#E3D4A7", league: "National", record: { wins: 84, losses: 78 } }
    ]);
  }, []);

  const americanLeagueTeams = teams.filter(team => team.league === 'American').sort((a, b) => (b.record.wins / (b.record.wins + b.record.losses)) - (a.record.wins / (a.record.wins + a.record.losses)));
  const nationalLeagueTeams = teams.filter(team => team.league === 'National').sort((a, b) => (b.record.wins / (b.record.wins + b.record.losses)) - (a.record.wins / (a.record.wins + a.record.losses)));

  return (
    <div className="mlb-page">
      {/* Popular Picks Section */}
      <div className="popular-picks-section">
        <h2>MLB Hot Picks</h2>
        <div className="picks-container">
          {popularPicks.map((pick) => (
            <div key={pick.id} className="pick-card">
              <div className="pick-header">
                <span className="game-info">{pick.game}</span>
                <span className={`confidence confidence-${pick.confidence.toLowerCase()}`}>
                  {pick.confidence}
                </span>
              </div>
              <div className="pick-content">
                <h4 className="player-name">{pick.player}</h4>
                <div className="pick-details">
                  <span className="stat-line">{pick.stat} {pick.line}</span>
                  <span className="odds">{pick.odds}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* News Section */}
      <div className="news-section">
        <h2>Latest MLB News</h2>
        <div className="news-container">
          {news.map((item) => (
            <div key={item.id} className="news-card">
              <div className="news-image">
                <img src={item.image} alt={item.title} />
              </div>
              <div className="news-content">
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <span className="timestamp">{item.timestamp}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Teams Section */}
      <div className="teams-section">
        <h2>MLB Teams</h2>
        <div className="conferences-container">
          {/* American League */}
          <div className="conference">
            <h3 className="conference-title">American League</h3>
            <div className="teams-grid">
              {americanLeagueTeams.map((team, index) => (
                <div key={team.id} className="team-card">
                  <div className="team-rank">#{index + 1}</div>
                  <div className="team-logo">
                    <img src={team.logo} alt={`${team.city} ${team.name}`} />
                  </div>
                  <div className="team-info">
                    <h4>{team.city} {team.name}</h4>
                    <span className="team-record">{team.record.wins}-{team.record.losses}</span>
                  </div>
                  <div 
                    className="team-colors"
                    style={{
                      background: `linear-gradient(45deg, ${team.primaryColor} 50%, ${team.secondaryColor} 50%)`
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* National League */}
          <div className="conference">
            <h3 className="conference-title">National League</h3>
            <div className="teams-grid">
              {nationalLeagueTeams.map((team, index) => (
                <div key={team.id} className="team-card">
                  <div className="team-rank">#{index + 1}</div>
                  <div className="team-logo">
                    <img src={team.logo} alt={`${team.city} ${team.name}`} />
                  </div>
                  <div className="team-info">
                    <h4>{team.city} {team.name}</h4>
                    <span className="team-record">{team.record.wins}-{team.record.losses}</span>
                  </div>
                  <div 
                    className="team-colors"
                    style={{
                      background: `linear-gradient(45deg, ${team.primaryColor} 50%, ${team.secondaryColor} 50%)`
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MLB;