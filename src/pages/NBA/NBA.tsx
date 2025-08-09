import React, { useEffect, useState } from "react";
import "./nba.scss";

interface Pick {
  id: number;
  player: string;
  stat: string;
  line: string;
  odds: string;
  confidence: "High" | "Medium" | "Low";
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
  conference: "East" | "West";
  record: {
    wins: number;
    losses: number;
  };
}

const NBA: React.FC = () => {
  const [popularPicks, setPopularPicks] = useState<Pick[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    // Mock data - replace with actual API calls
    setPopularPicks([
      {
        id: 1,
        player: "LeBron James",
        stat: "Points",
        line: "Over 25.5",
        odds: "-110",
        confidence: "High",
        game: "LAL vs GSW",
      },
      {
        id: 2,
        player: "Stephen Curry",
        stat: "3-Pointers",
        line: "Over 4.5",
        odds: "+105",
        confidence: "Medium",
        game: "GSW vs LAL",
      },
      {
        id: 3,
        player: "Giannis Antetokounmpo",
        stat: "Rebounds",
        line: "Over 11.5",
        odds: "-105",
        confidence: "High",
        game: "MIL vs BOS",
      },
      {
        id: 4,
        player: "Luka Dončić",
        stat: "Assists",
        line: "Over 8.5",
        odds: "-115",
        confidence: "Medium",
        game: "DAL vs PHX",
      },
      {
        id: 5,
        player: "Jayson Tatum",
        stat: "Points",
        line: "Over 27.5",
        odds: "-110",
        confidence: "High",
        game: "BOS vs MIL",
      },
      {
        id: 6,
        player: "Nikola Jokić",
        stat: "Triple-Double",
        line: "Yes",
        odds: "+180",
        confidence: "Low",
        game: "DEN vs LAC",
      },
    ]);

    setNews([
      {
        id: 1,
        title: "LeBron James Reaches Historic Milestone",
        summary:
          "The Lakers superstar becomes the first player to achieve this unprecedented feat in NBA history.",
        timestamp: "2 hours ago",
        image: "/api/placeholder/200/120",
      },
      {
        id: 2,
        title: "Trade Deadline Buzz: Eastern Conference Shakeup",
        summary:
          "Multiple teams in the East are exploring major moves ahead of the February deadline.",
        timestamp: "4 hours ago",
        image: "/api/placeholder/200/120",
      },
      {
        id: 3,
        title: "MVP Race Heats Up as Season Progresses",
        summary:
          "Three players emerge as frontrunners for this year's Most Valuable Player award.",
        timestamp: "6 hours ago",
        image: "/api/placeholder/200/120",
      },
    ]);

    // Mock NBA teams data
    setTeams([
      // Eastern Conference
      {
        id: 1,
        name: "Celtics",
        city: "Boston",
        abbreviation: "BOS",
        logo: "/api/placeholder/60/60",
        primaryColor: "#007A33",
        secondaryColor: "#BA9653",
        conference: "East",
        record: { wins: 45, losses: 12 },
      },
      {
        id: 2,
        name: "Heat",
        city: "Miami",
        abbreviation: "MIA",
        logo: "/api/placeholder/60/60",
        primaryColor: "#98002E",
        secondaryColor: "#F9A01B",
        conference: "East",
        record: { wins: 35, losses: 22 },
      },
      {
        id: 3,
        name: "76ers",
        city: "Philadelphia",
        abbreviation: "PHI",
        logo: "/api/placeholder/60/60",
        primaryColor: "#006BB6",
        secondaryColor: "#ED174C",
        conference: "East",
        record: { wins: 32, losses: 25 },
      },
      {
        id: 4,
        name: "Bucks",
        city: "Milwaukee",
        abbreviation: "MIL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#00471B",
        secondaryColor: "#EEE1C6",
        conference: "East",
        record: { wins: 38, losses: 19 },
      },
      {
        id: 5,
        name: "Cavaliers",
        city: "Cleveland",
        abbreviation: "CLE",
        logo: "/api/placeholder/60/60",
        primaryColor: "#860038",
        secondaryColor: "#FDBB30",
        conference: "East",
        record: { wins: 36, losses: 21 },
      },
      {
        id: 6,
        name: "Knicks",
        city: "New York",
        abbreviation: "NYK",
        logo: "/api/placeholder/60/60",
        primaryColor: "#006BB6",
        secondaryColor: "#F58426",
        conference: "East",
        record: { wins: 34, losses: 23 },
      },
      {
        id: 7,
        name: "Nets",
        city: "Brooklyn",
        abbreviation: "BKN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#000000",
        secondaryColor: "#FFFFFF",
        conference: "East",
        record: { wins: 28, losses: 29 },
      },
      {
        id: 8,
        name: "Hawks",
        city: "Atlanta",
        abbreviation: "ATL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#E03A3E",
        secondaryColor: "#C1D32F",
        conference: "East",
        record: { wins: 25, losses: 32 },
      },
      {
        id: 9,
        name: "Raptors",
        city: "Toronto",
        abbreviation: "TOR",
        logo: "/api/placeholder/60/60",
        primaryColor: "#CE1141",
        secondaryColor: "#000000",
        conference: "East",
        record: { wins: 23, losses: 34 },
      },
      {
        id: 10,
        name: "Bulls",
        city: "Chicago",
        abbreviation: "CHI",
        logo: "/api/placeholder/60/60",
        primaryColor: "#CE1141",
        secondaryColor: "#000000",
        conference: "East",
        record: { wins: 22, losses: 35 },
      },
      {
        id: 11,
        name: "Pacers",
        city: "Indiana",
        abbreviation: "IND",
        logo: "/api/placeholder/60/60",
        primaryColor: "#002D62",
        secondaryColor: "#FDBB30",
        conference: "East",
        record: { wins: 30, losses: 27 },
      },
      {
        id: 12,
        name: "Magic",
        city: "Orlando",
        abbreviation: "ORL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0077C0",
        secondaryColor: "#C4CED4",
        conference: "East",
        record: { wins: 26, losses: 31 },
      },
      {
        id: 13,
        name: "Hornets",
        city: "Charlotte",
        abbreviation: "CHA",
        logo: "/api/placeholder/60/60",
        primaryColor: "#1D1160",
        secondaryColor: "#00788C",
        conference: "East",
        record: { wins: 15, losses: 42 },
      },
      {
        id: 14,
        name: "Wizards",
        city: "Washington",
        abbreviation: "WAS",
        logo: "/api/placeholder/60/60",
        primaryColor: "#002B5C",
        secondaryColor: "#E31837",
        conference: "East",
        record: { wins: 9, losses: 48 },
      },
      {
        id: 15,
        name: "Pistons",
        city: "Detroit",
        abbreviation: "DET",
        logo: "/api/placeholder/60/60",
        primaryColor: "#C8102E",
        secondaryColor: "#1D42BA",
        conference: "East",
        record: { wins: 8, losses: 49 },
      },

      // Western Conference
      {
        id: 16,
        name: "Nuggets",
        city: "Denver",
        abbreviation: "DEN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0E2240",
        secondaryColor: "#FEC524",
        conference: "West",
        record: { wins: 42, losses: 15 },
      },
      {
        id: 17,
        name: "Grizzlies",
        city: "Memphis",
        abbreviation: "MEM",
        logo: "/api/placeholder/60/60",
        primaryColor: "#5D76A9",
        secondaryColor: "#12173F",
        conference: "West",
        record: { wins: 35, losses: 22 },
      },
      {
        id: 18,
        name: "Kings",
        city: "Sacramento",
        abbreviation: "SAC",
        logo: "/api/placeholder/60/60",
        primaryColor: "#5A2D81",
        secondaryColor: "#63727A",
        conference: "West",
        record: { wins: 33, losses: 24 },
      },
      {
        id: 19,
        name: "Suns",
        city: "Phoenix",
        abbreviation: "PHX",
        logo: "/api/placeholder/60/60",
        primaryColor: "#1D1160",
        secondaryColor: "#E56020",
        conference: "West",
        record: { wins: 31, losses: 26 },
      },
      {
        id: 20,
        name: "Clippers",
        city: "LA",
        abbreviation: "LAC",
        logo: "/api/placeholder/60/60",
        primaryColor: "#C8102E",
        secondaryColor: "#1D428A",
        conference: "West",
        record: { wins: 37, losses: 20 },
      },
      {
        id: 21,
        name: "Lakers",
        city: "Los Angeles",
        abbreviation: "LAL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#552583",
        secondaryColor: "#FDB927",
        conference: "West",
        record: { wins: 29, losses: 28 },
      },
      {
        id: 22,
        name: "Warriors",
        city: "Golden State",
        abbreviation: "GSW",
        logo: "/api/placeholder/60/60",
        primaryColor: "#1D428A",
        secondaryColor: "#FFC72C",
        conference: "West",
        record: { wins: 32, losses: 25 },
      },
      {
        id: 23,
        name: "Timberwolves",
        city: "Minnesota",
        abbreviation: "MIN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0C2340",
        secondaryColor: "#236192",
        conference: "West",
        record: { wins: 34, losses: 23 },
      },
      {
        id: 24,
        name: "Pelicans",
        city: "New Orleans",
        abbreviation: "NOP",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0C2340",
        secondaryColor: "#C8102E",
        conference: "West",
        record: { wins: 27, losses: 30 },
      },
      {
        id: 25,
        name: "Thunder",
        city: "Oklahoma City",
        abbreviation: "OKC",
        logo: "/api/placeholder/60/60",
        primaryColor: "#007AC1",
        secondaryColor: "#EF3B24",
        conference: "West",
        record: { wins: 39, losses: 18 },
      },
      {
        id: 26,
        name: "Mavericks",
        city: "Dallas",
        abbreviation: "DAL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#00538C",
        secondaryColor: "#002B5E",
        conference: "West",
        record: { wins: 28, losses: 29 },
      },
      {
        id: 27,
        name: "Jazz",
        city: "Utah",
        abbreviation: "UTA",
        logo: "/api/placeholder/60/60",
        primaryColor: "#002B5C",
        secondaryColor: "#00471B",
        conference: "West",
        record: { wins: 24, losses: 33 },
      },
      {
        id: 28,
        name: "Blazers",
        city: "Portland",
        abbreviation: "POR",
        logo: "/api/placeholder/60/60",
        primaryColor: "#E03A3E",
        secondaryColor: "#000000",
        conference: "West",
        record: { wins: 21, losses: 36 },
      },
      {
        id: 29,
        name: "Rockets",
        city: "Houston",
        abbreviation: "HOU",
        logo: "/api/placeholder/60/60",
        primaryColor: "#CE1141",
        secondaryColor: "#000000",
        conference: "West",
        record: { wins: 20, losses: 37 },
      },
      {
        id: 30,
        name: "Spurs",
        city: "San Antonio",
        abbreviation: "SAS",
        logo: "/api/placeholder/60/60",
        primaryColor: "#C4CED4",
        secondaryColor: "#000000",
        conference: "West",
        record: { wins: 14, losses: 43 },
      },
    ]);
  }, []);

  const eastTeams = teams
    .filter((team) => team.conference === "East")
    .sort(
      (a, b) =>
        b.record.wins / (b.record.wins + b.record.losses) -
        a.record.wins / (a.record.wins + a.record.losses)
    );
  const westTeams = teams
    .filter((team) => team.conference === "West")
    .sort(
      (a, b) =>
        b.record.wins / (b.record.wins + b.record.losses) -
        a.record.wins / (a.record.wins + a.record.losses)
    );

  return (
    <div className="nba-page">
      {/* Popular Picks Section */}
      <div className="popular-picks-section">
        <h2>NBA Hot Picks</h2>
        <div className="picks-container">
          {popularPicks.map((pick) => (
            <div key={pick.id} className="pick-card">
              <div className="pick-header">
                <span className="game-info">{pick.game}</span>
                <span
                  className={`confidence confidence-${pick.confidence.toLowerCase()}`}
                >
                  {pick.confidence}
                </span>
              </div>
              <div className="pick-content">
                <h4 className="player-name">{pick.player}</h4>
                <div className="pick-details">
                  <span className="stat-line">
                    {pick.stat} {pick.line}
                  </span>
                  <span className="odds">{pick.odds}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* News Section */}
      <div className="news-section">
        <h2>Latest NBA News</h2>
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
        <h2>NBA Teams</h2>
        <div className="conferences-container">
          {/* Eastern Conference */}
          <div className="conference">
            <h3 className="conference-title">Eastern Conference</h3>
            <div className="teams-grid">
              {eastTeams.map((team, index) => (
                <div key={team.id} className="team-card">
                  <div className="team-rank">#{index + 1}</div>
                  <div className="team-logo">
                    <img src={team.logo} alt={`${team.city} ${team.name}`} />
                  </div>
                  <div className="team-info">
                    <h4>
                      {team.city} {team.name}
                    </h4>
                    <span className="team-record">
                      {team.record.wins}-{team.record.losses}
                    </span>
                  </div>
                  <div
                    className="team-colors"
                    style={{
                      background: `linear-gradient(45deg, ${team.primaryColor} 50%, ${team.secondaryColor} 50%)`,
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
              {westTeams.map((team, index) => (
                <div key={team.id} className="team-card">
                  <div className="team-rank">#{index + 1}</div>
                  <div className="team-logo">
                    <img src={team.logo} alt={`${team.city} ${team.name}`} />
                  </div>
                  <div className="team-info">
                    <h4>
                      {team.city} {team.name}
                    </h4>
                    <span className="team-record">
                      {team.record.wins}-{team.record.losses}
                    </span>
                  </div>
                  <div
                    className="team-colors"
                    style={{
                      background: `linear-gradient(45deg, ${team.primaryColor} 50%, ${team.secondaryColor} 50%)`,
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

export default NBA;
