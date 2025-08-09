import React, { useEffect, useState } from "react";
import "./nfl.scss";

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
  conference: "AFC" | "NFC";
  record: {
    wins: number;
    losses: number;
  };
}

const NFL: React.FC = () => {
  const [popularPicks, setPopularPicks] = useState<Pick[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    // Mock data - replace with actual API calls
    setPopularPicks([
      {
        id: 1,
        player: "Josh Allen",
        stat: "Passing Yards",
        line: "Over 285.5",
        odds: "-115",
        confidence: "High",
        game: "BUF vs MIA",
      },
      {
        id: 2,
        player: "Christian McCaffrey",
        stat: "Rushing Yards",
        line: "Over 95.5",
        odds: "-110",
        confidence: "High",
        game: "SF vs LAR",
      },
      {
        id: 3,
        player: "Cooper Kupp",
        stat: "Receiving Yards",
        line: "Over 68.5",
        odds: "+105",
        confidence: "Medium",
        game: "LAR vs SF",
      },
      {
        id: 4,
        player: "Lamar Jackson",
        stat: "Rushing + Passing TDs",
        line: "Over 2.5",
        odds: "-120",
        confidence: "High",
        game: "BAL vs CIN",
      },
      {
        id: 5,
        player: "Travis Kelce",
        stat: "Receptions",
        line: "Over 6.5",
        odds: "-105",
        confidence: "Medium",
        game: "KC vs DEN",
      },
      {
        id: 6,
        player: "Derrick Henry",
        stat: "Anytime Touchdown",
        line: "Yes",
        odds: "-140",
        confidence: "High",
        game: "TEN vs HOU",
      },
    ]);

    setNews([
      {
        id: 1,
        title: "Playoff Race Intensifies as Season Enters Final Stretch",
        summary:
          "Multiple teams fighting for wild card spots with just weeks remaining in the regular season.",
        timestamp: "1 hour ago",
        image: "/api/placeholder/200/120",
      },
      {
        id: 2,
        title: "MVP Candidates Make Their Case in Week 16",
        summary:
          "Josh Allen, Lamar Jackson, and Dak Prescott all put up impressive numbers in crucial games.",
        timestamp: "3 hours ago",
        image: "/api/placeholder/200/120",
      },
      {
        id: 3,
        title: "Injury Report: Key Players Return for Playoff Push",
        summary:
          "Several star players expected to return from injury just in time for the final weeks.",
        timestamp: "5 hours ago",
        image: "/api/placeholder/200/120",
      },
    ]);

    // Mock NFL teams data
    setTeams([
      // AFC Teams
      {
        id: 1,
        name: "Bills",
        city: "Buffalo",
        abbreviation: "BUF",
        logo: "/api/placeholder/60/60",
        primaryColor: "#00338D",
        secondaryColor: "#C60C30",
        conference: "AFC",
        record: { wins: 12, losses: 3 },
      },
      {
        id: 2,
        name: "Dolphins",
        city: "Miami",
        abbreviation: "MIA",
        logo: "/api/placeholder/60/60",
        primaryColor: "#008E97",
        secondaryColor: "#FC4C02",
        conference: "AFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 3,
        name: "Patriots",
        city: "New England",
        abbreviation: "NE",
        logo: "/api/placeholder/60/60",
        primaryColor: "#002244",
        secondaryColor: "#C60C30",
        conference: "AFC",
        record: { wins: 4, losses: 11 },
      },
      {
        id: 4,
        name: "Jets",
        city: "New York",
        abbreviation: "NYJ",
        logo: "/api/placeholder/60/60",
        primaryColor: "#125740",
        secondaryColor: "#000000",
        conference: "AFC",
        record: { wins: 6, losses: 9 },
      },
      {
        id: 5,
        name: "Ravens",
        city: "Baltimore",
        abbreviation: "BAL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#241773",
        secondaryColor: "#000000",
        conference: "AFC",
        record: { wins: 11, losses: 4 },
      },
      {
        id: 6,
        name: "Bengals",
        city: "Cincinnati",
        abbreviation: "CIN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#FB4F14",
        secondaryColor: "#000000",
        conference: "AFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 7,
        name: "Browns",
        city: "Cleveland",
        abbreviation: "CLE",
        logo: "/api/placeholder/60/60",
        primaryColor: "#311D00",
        secondaryColor: "#FF3C00",
        conference: "AFC",
        record: { wins: 10, losses: 5 },
      },
      {
        id: 8,
        name: "Steelers",
        city: "Pittsburgh",
        abbreviation: "PIT",
        logo: "/api/placeholder/60/60",
        primaryColor: "#FFB612",
        secondaryColor: "#000000",
        conference: "AFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 9,
        name: "Texans",
        city: "Houston",
        abbreviation: "HOU",
        logo: "/api/placeholder/60/60",
        primaryColor: "#03202F",
        secondaryColor: "#A71930",
        conference: "AFC",
        record: { wins: 9, losses: 6 },
      },
      {
        id: 10,
        name: "Colts",
        city: "Indianapolis",
        abbreviation: "IND",
        logo: "/api/placeholder/60/60",
        primaryColor: "#002C5F",
        secondaryColor: "#A2AAAD",
        conference: "AFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 11,
        name: "Jaguars",
        city: "Jacksonville",
        abbreviation: "JAX",
        logo: "/api/placeholder/60/60",
        primaryColor: "#006778",
        secondaryColor: "#9F792C",
        conference: "AFC",
        record: { wins: 2, losses: 13 },
      },
      {
        id: 12,
        name: "Titans",
        city: "Tennessee",
        abbreviation: "TEN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0C2340",
        secondaryColor: "#4B92DB",
        conference: "AFC",
        record: { wins: 5, losses: 10 },
      },
      {
        id: 13,
        name: "Broncos",
        city: "Denver",
        abbreviation: "DEN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#FB4F14",
        secondaryColor: "#002244",
        conference: "AFC",
        record: { wins: 7, losses: 8 },
      },
      {
        id: 14,
        name: "Chiefs",
        city: "Kansas City",
        abbreviation: "KC",
        logo: "/api/placeholder/60/60",
        primaryColor: "#E31837",
        secondaryColor: "#FFB81C",
        conference: "AFC",
        record: { wins: 13, losses: 2 },
      },
      {
        id: 15,
        name: "Raiders",
        city: "Las Vegas",
        abbreviation: "LV",
        logo: "/api/placeholder/60/60",
        primaryColor: "#000000",
        secondaryColor: "#A5ACAF",
        conference: "AFC",
        record: { wins: 6, losses: 9 },
      },
      {
        id: 16,
        name: "Chargers",
        city: "Los Angeles",
        abbreviation: "LAC",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0080C6",
        secondaryColor: "#FFC20E",
        conference: "AFC",
        record: { wins: 9, losses: 6 },
      },

      // NFC Teams
      {
        id: 17,
        name: "Cowboys",
        city: "Dallas",
        abbreviation: "DAL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#003594",
        secondaryColor: "#041E42",
        conference: "NFC",
        record: { wins: 10, losses: 5 },
      },
      {
        id: 18,
        name: "Giants",
        city: "New York",
        abbreviation: "NYG",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0B2265",
        secondaryColor: "#A71930",
        conference: "NFC",
        record: { wins: 5, losses: 10 },
      },
      {
        id: 19,
        name: "Eagles",
        city: "Philadelphia",
        abbreviation: "PHI",
        logo: "/api/placeholder/60/60",
        primaryColor: "#004C54",
        secondaryColor: "#A5ACAF",
        conference: "NFC",
        record: { wins: 11, losses: 4 },
      },
      {
        id: 20,
        name: "Commanders",
        city: "Washington",
        abbreviation: "WAS",
        logo: "/api/placeholder/60/60",
        primaryColor: "#5A1414",
        secondaryColor: "#FFB612",
        conference: "NFC",
        record: { wins: 4, losses: 11 },
      },
      {
        id: 21,
        name: "Bears",
        city: "Chicago",
        abbreviation: "CHI",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0B162A",
        secondaryColor: "#C83803",
        conference: "NFC",
        record: { wins: 6, losses: 9 },
      },
      {
        id: 22,
        name: "Lions",
        city: "Detroit",
        abbreviation: "DET",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0076B6",
        secondaryColor: "#B0B7BC",
        conference: "NFC",
        record: { wins: 11, losses: 4 },
      },
      {
        id: 23,
        name: "Packers",
        city: "Green Bay",
        abbreviation: "GB",
        logo: "/api/placeholder/60/60",
        primaryColor: "#203731",
        secondaryColor: "#FFB612",
        conference: "NFC",
        record: { wins: 7, losses: 8 },
      },
      {
        id: 24,
        name: "Vikings",
        city: "Minnesota",
        abbreviation: "MIN",
        logo: "/api/placeholder/60/60",
        primaryColor: "#4F2683",
        secondaryColor: "#FFC62F",
        conference: "NFC",
        record: { wins: 7, losses: 8 },
      },
      {
        id: 25,
        name: "Falcons",
        city: "Atlanta",
        abbreviation: "ATL",
        logo: "/api/placeholder/60/60",
        primaryColor: "#A71930",
        secondaryColor: "#000000",
        conference: "NFC",
        record: { wins: 6, losses: 9 },
      },
      {
        id: 26,
        name: "Panthers",
        city: "Carolina",
        abbreviation: "CAR",
        logo: "/api/placeholder/60/60",
        primaryColor: "#0085CA",
        secondaryColor: "#101820",
        conference: "NFC",
        record: { wins: 2, losses: 13 },
      },
      {
        id: 27,
        name: "Saints",
        city: "New Orleans",
        abbreviation: "NO",
        logo: "/api/placeholder/60/60",
        primaryColor: "#D3BC8D",
        secondaryColor: "#101820",
        conference: "NFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 28,
        name: "Buccaneers",
        city: "Tampa Bay",
        abbreviation: "TB",
        logo: "/api/placeholder/60/60",
        primaryColor: "#D50A0A",
        secondaryColor: "#FF7900",
        conference: "NFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 29,
        name: "Cardinals",
        city: "Arizona",
        abbreviation: "ARI",
        logo: "/api/placeholder/60/60",
        primaryColor: "#97233F",
        secondaryColor: "#000000",
        conference: "NFC",
        record: { wins: 3, losses: 12 },
      },
      {
        id: 30,
        name: "Rams",
        city: "Los Angeles",
        abbreviation: "LAR",
        logo: "/api/placeholder/60/60",
        primaryColor: "#003594",
        secondaryColor: "#FFA300",
        conference: "NFC",
        record: { wins: 8, losses: 7 },
      },
      {
        id: 31,
        name: "49ers",
        city: "San Francisco",
        abbreviation: "SF",
        logo: "/api/placeholder/60/60",
        primaryColor: "#AA0000",
        secondaryColor: "#B3995D",
        conference: "NFC",
        record: { wins: 11, losses: 4 },
      },
      {
        id: 32,
        name: "Seahawks",
        city: "Seattle",
        abbreviation: "SEA",
        logo: "/api/placeholder/60/60",
        primaryColor: "#002244",
        secondaryColor: "#69BE28",
        conference: "NFC",
        record: { wins: 8, losses: 7 },
      },
    ]);
  }, []);

  const afcTeams = teams
    .filter((team) => team.conference === "AFC")
    .sort(
      (a, b) =>
        b.record.wins / (b.record.wins + b.record.losses) -
        a.record.wins / (a.record.wins + a.record.losses)
    );
  const nfcTeams = teams
    .filter((team) => team.conference === "NFC")
    .sort(
      (a, b) =>
        b.record.wins / (b.record.wins + b.record.losses) -
        a.record.wins / (a.record.wins + a.record.losses)
    );

  return (
    <div className="nfl-page">
      {/* Popular Picks Section */}
      <div className="popular-picks-section">
        <h2>NFL Hot Picks</h2>
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
        <h2>Latest NFL News</h2>
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
        <h2>NFL Teams</h2>
        <div className="conferences-container">
          {/* AFC Conference */}
          <div className="conference">
            <h3 className="conference-title">AFC Conference</h3>
            <div className="teams-grid">
              {afcTeams.map((team, index) => (
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

          {/* NFC Conference */}
          <div className="conference">
            <h3 className="conference-title">NFC Conference</h3>
            <div className="teams-grid">
              {nfcTeams.map((team, index) => (
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

export default NFL;
