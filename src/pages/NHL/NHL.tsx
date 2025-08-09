import React, { useState, useEffect } from 'react';
import './nhl.scss';

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
  conference: 'Eastern' | 'Western';
  record: {
    wins: number;
    losses: number;
    overtimeLosses: number;
  };
}

const NHL: React.FC = () => {
  const [popularPicks, setPopularPicks] = useState<Pick[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    // Mock data - replace with actual API calls
    setPopularPicks([
      {
        id: 1,
        player: "Connor McDavid",
        stat: "Points",
        line: "Over 1.5",
        odds: "-125",
        confidence: "High",
        game: "EDM vs CGY"
      },
      {
        id: 2,
        player: "David Pastrnak",
        stat: "Goals",
        line: "Over 0.5",
        odds: "-110",
        confidence: "High",
        game: "BOS vs NYR"
      },
      {
        id: 3,
        player: "Erik Karlsson",
        stat: "Assists",
        line: "Over 0.5",
        odds: "+105",
        confidence: "Medium",
        game: "PIT vs WSH"
      },
      {
        id: 4,
        player: "Igor Shesterkin",
        stat: "Saves",
        line: "Over 28.5",
        odds: "-115",
        confidence: "High",
        game: "NYR vs BOS"
      },
      {
        id: 5,
        player: "Nathan MacKinnon",
        stat: "Shots on Goal",
        line: "Over 3.5",
        odds: "-120",
        confidence: "Medium",
        game: "COL vs VGK"
      },
      {
        id: 6,
        player: "Leon Draisaitl",
        stat: "Power Play Points",
        line: "Over 0.5",
        odds: "+180",
        confidence: "Low",
        game: "EDM vs CGY"
      }
    ]);

    setNews([
      {
        id: 1,
        title: "McDavid Chasing History with Record-Breaking Season",
        summary: "Edmonton's superstar is on pace for one of the greatest individual seasons in NHL history.",
        timestamp: "2 hours ago",
        image: "/api/placeholder/200/120"
      },
      {
        id: 2,
        title: "Trade Deadline Approaches: Buyers and Sellers Identified",
        summary: "With the trade deadline weeks away, playoff contenders are making their final pushes.",
        timestamp: "4 hours ago",
        image: "/api/placeholder/200/120"
      },
      {
        id: 3,
        title: "Rookie of the Year Race Heating Up",
        summary: "Several first-year players making strong cases for the Calder Trophy this season.",
        timestamp: "6 hours ago",
        image: "/api/placeholder/200/120"
      }
    ]);

    // Mock NHL teams data
    setTeams([
      // Eastern Conference
      { id: 1, name: "Bruins", city: "Boston", abbreviation: "BOS", logo: "/api/placeholder/60/60", primaryColor: "#FFB81C", secondaryColor: "#000000", conference: "Eastern", record: { wins: 28, losses: 8, overtimeLosses: 3 } },
      { id: 2, name: "Rangers", city: "New York", abbreviation: "NYR", logo: "/api/placeholder/60/60", primaryColor: "#0038A8", secondaryColor: "#CE1126", conference: "Eastern", record: { wins: 25, losses: 12, overtimeLosses: 2 } },
      { id: 3, name: "Devils", city: "New Jersey", abbreviation: "NJD", logo: "/api/placeholder/60/60", primaryColor: "#CE1126", secondaryColor: "#000000", conference: "Eastern", record: { wins: 24, losses: 13, overtimeLosses: 2 } },
      { id: 4, name: "Hurricanes", city: "Carolina", abbreviation: "CAR", logo: "/api/placeholder/60/60", primaryColor: "#CC0000", secondaryColor: "#000000", conference: "Eastern", record: { wins: 23, losses: 14, overtimeLosses: 3 } },
      { id: 5, name: "Maple Leafs", city: "Toronto", abbreviation: "TOR", logo: "/api/placeholder/60/60", primaryColor: "#003E7E", secondaryColor: "#FFFFFF", conference: "Eastern", record: { wins: 22, losses: 15, overtimeLosses: 4 } },
      { id: 6, name: "Panthers", city: "Florida", abbreviation: "FLA", logo: "/api/placeholder/60/60", primaryColor: "#041E42", secondaryColor: "#C8102E", conference: "Eastern", record: { wins: 21, losses: 16, overtimeLosses: 4 } },
      { id: 7, name: "Lightning", city: "Tampa Bay", abbreviation: "TB", logo: "/api/placeholder/60/60", primaryColor: "#002868", secondaryColor: "#FFFFFF", conference: "Eastern", record: { wins: 20, losses: 17, overtimeLosses: 4 } },
      { id: 8, name: "Islanders", city: "New York", abbreviation: "NYI", logo: "/api/placeholder/60/60", primaryColor: "#00539B", secondaryColor: "#F47D30", conference: "Eastern", record: { wins: 19, losses: 18, overtimeLosses: 4 } },
      { id: 9, name: "Capitals", city: "Washington", abbreviation: "WSH", logo: "/api/placeholder/60/60", primaryColor: "#C8102E", secondaryColor: "#041E42", conference: "Eastern", record: { wins: 18, losses: 19, overtimeLosses: 4 } },
      { id: 10, name: "Penguins", city: "Pittsburgh", abbreviation: "PIT", logo: "/api/placeholder/60/60", primaryColor: "#000000", secondaryColor: "#FCB514", conference: "Eastern", record: { wins: 17, losses: 20, overtimeLosses: 4 } },
      { id: 11, name: "Sabres", city: "Buffalo", abbreviation: "BUF", logo: "/api/placeholder/60/60", primaryColor: "#003087", secondaryColor: "#FFB81C", conference: "Eastern", record: { wins: 16, losses: 21, overtimeLosses: 4 } },
      { id: 12, name: "Red Wings", city: "Detroit", abbreviation: "DET", logo: "/api/placeholder/60/60", primaryColor: "#CE1126", secondaryColor: "#FFFFFF", conference: "Eastern", record: { wins: 15, losses: 22, overtimeLosses: 4 } },
      { id: 13, name: "Senators", city: "Ottawa", abbreviation: "OTT", logo: "/api/placeholder/60/60", primaryColor: "#C52032", secondaryColor: "#000000", conference: "Eastern", record: { wins: 14, losses: 23, overtimeLosses: 4 } },
      { id: 14, name: "Flyers", city: "Philadelphia", abbreviation: "PHI", logo: "/api/placeholder/60/60", primaryColor: "#F74902", secondaryColor: "#000000", conference: "Eastern", record: { wins: 13, losses: 24, overtimeLosses: 4 } },
      { id: 15, name: "Blue Jackets", city: "Columbus", abbreviation: "CBJ", logo: "/api/placeholder/60/60", primaryColor: "#002654", secondaryColor: "#CE1126", conference: "Eastern", record: { wins: 12, losses: 25, overtimeLosses: 4 } },
      { id: 16, name: "Canadiens", city: "Montreal", abbreviation: "MTL", logo: "/api/placeholder/60/60", primaryColor: "#AF1E2D", secondaryColor: "#192168", conference: "Eastern", record: { wins: 11, losses: 26, overtimeLosses: 4 } },

      // Western Conference
      { id: 17, name: "Golden Knights", city: "Vegas", abbreviation: "VGK", logo: "/api/placeholder/60/60", primaryColor: "#B4975A", secondaryColor: "#000000", conference: "Western", record: { wins: 28, losses: 10, overtimeLosses: 1 } },
      { id: 18, name: "Avalanche", city: "Colorado", abbreviation: "COL", logo: "/api/placeholder/60/60", primaryColor: "#6F263D", secondaryColor: "#236192", conference: "Western", record: { wins: 26, losses: 13, overtimeLosses: 2 } },
      { id: 19, name: "Stars", city: "Dallas", abbreviation: "DAL", logo: "/api/placeholder/60/60", primaryColor: "#006847", secondaryColor: "#8F8F8C", conference: "Western", record: { wins: 25, losses: 14, overtimeLosses: 2 } },
      { id: 20, name: "Jets", city: "Winnipeg", abbreviation: "WPG", logo: "/api/placeholder/60/60", primaryColor: "#041E42", secondaryColor: "#004C97", conference: "Western", record: { wins: 24, losses: 15, overtimeLosses: 2 } },
      { id: 21, name: "Oilers", city: "Edmonton", abbreviation: "EDM", logo: "/api/placeholder/60/60", primaryColor: "#041E42", secondaryColor: "#FF4C00", conference: "Western", record: { wins: 23, losses: 16, overtimeLosses: 2 } },
      { id: 22, name: "Kings", city: "Los Angeles", abbreviation: "LAK", logo: "/api/placeholder/60/60", primaryColor: "#111111", secondaryColor: "#A2AAAD", conference: "Western", record: { wins: 22, losses: 17, overtimeLosses: 2 } },
      { id: 23, name: "Wild", city: "Minnesota", abbreviation: "MIN", logo: "/api/placeholder/60/60", primaryColor: "#154734", secondaryColor: "#A6192E", conference: "Western", record: { wins: 21, losses: 18, overtimeLosses: 2 } },
      { id: 24, name: "Flames", city: "Calgary", abbreviation: "CGY", logo: "/api/placeholder/60/60", primaryColor: "#C8102E", secondaryColor: "#F1BE48", conference: "Western", record: { wins: 20, losses: 19, overtimeLosses: 2 } },
      { id: 25, name: "Predators", city: "Nashville", abbreviation: "NSH", logo: "/api/placeholder/60/60", primaryColor: "#FFB81C", secondaryColor: "#041E42", conference: "Western", record: { wins: 19, losses: 20, overtimeLosses: 2 } },
      { id: 26, name: "Blues", city: "St. Louis", abbreviation: "STL", logo: "/api/placeholder/60/60", primaryColor: "#002F87", secondaryColor: "#FCB514", conference: "Western", record: { wins: 18, losses: 21, overtimeLosses: 2 } },
      { id: 27, name: "Canucks", city: "Vancouver", abbreviation: "VAN", logo: "/api/placeholder/60/60", primaryColor: "#001F5B", secondaryColor: "#00843D", conference: "Western", record: { wins: 17, losses: 22, overtimeLosses: 2 } },
      { id: 28, name: "Kraken", city: "Seattle", abbreviation: "SEA", logo: "/api/placeholder/60/60", primaryColor: "#001628", secondaryColor: "#99D9D9", conference: "Western", record: { wins: 16, losses: 23, overtimeLosses: 2 } },
      { id: 29, name: "Sharks", city: "San Jose", abbreviation: "SJ", logo: "/api/placeholder/60/60", primaryColor: "#006D75", secondaryColor: "#EA7200", conference: "Western", record: { wins: 15, losses: 24, overtimeLosses: 2 } },
      { id: 30, name: "Ducks", city: "Anaheim", abbreviation: "ANA", logo: "/api/placeholder/60/60", primaryColor: "#F47A38", secondaryColor: "#000000", conference: "Western", record: { wins: 14, losses: 25, overtimeLosses: 2 } },
      { id: 31, name: "Coyotes", city: "Arizona", abbreviation: "ARI", logo: "/api/placeholder/60/60", primaryColor: "#8C2633", secondaryColor: "#E2D6B5", conference: "Western", record: { wins: 13, losses: 26, overtimeLosses: 2 } },
      { id: 32, name: "Blackhawks", city: "Chicago", abbreviation: "CHI", logo: "/api/placeholder/60/60", primaryColor: "#CF0A2C", secondaryColor: "#000000", conference: "Western", record: { wins: 12, losses: 27, overtimeLosses: 2 } }
    ]);
  }, []);

  const easternTeams = teams.filter(team => team.conference === 'Eastern').sort((a, b) => {
    const aPoints = (a.record.wins * 2) + a.record.overtimeLosses;
    const bPoints = (b.record.wins * 2) + b.record.overtimeLosses;
    return bPoints - aPoints;
  });
  
  const westernTeams = teams.filter(team => team.conference === 'Western').sort((a, b) => {
    const aPoints = (a.record.wins * 2) + a.record.overtimeLosses;
    const bPoints = (b.record.wins * 2) + b.record.overtimeLosses;
    return bPoints - aPoints;
  });

  return (
    <div className="nhl-page">
      {/* Popular Picks Section */}
      <div className="popular-picks-section">
        <h2>NHL Hot Picks</h2>
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
        <h2>Latest NHL News</h2>
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
        <h2>NHL Teams</h2>
        <div className="conferences-container">
          {/* Eastern Conference */}
          <div className="conference">
            <h3 className="conference-title">Eastern Conference</h3>
            <div className="teams-grid">
              {easternTeams.map((team, index) => (
                <div key={team.id} className="team-card">
                  <div className="team-rank">#{index + 1}</div>
                  <div className="team-logo">
                    <img src={team.logo} alt={`${team.city} ${team.name}`} />
                  </div>
                  <div className="team-info">
                    <h4>{team.city} {team.name}</h4>
                    <span className="team-record">{team.record.wins}-{team.record.losses}-{team.record.overtimeLosses}</span>
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

          {/* Western Conference */}
          <div className="conference">
            <h3 className="conference-title">Western Conference</h3>
            <div className="teams-grid">
              {westernTeams.map((team, index) => (
                <div key={team.id} className="team-card">
                  <div className="team-rank">#{index + 1}</div>
                  <div className="team-logo">
                    <img src={team.logo} alt={`${team.city} ${team.name}`} />
                  </div>
                  <div className="team-info">
                    <h4>{team.city} {team.name}</h4>
                    <span className="team-record">{team.record.wins}-{team.record.losses}-{team.record.overtimeLosses}</span>
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

export default NHL;