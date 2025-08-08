import React, {useState, useEffect } from 'react';
import './nba.scss';
import NBATeamCard from '../../components/NBATeamCard/NBATeamCard';

const NBA: React.FC = () => {
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedConference, setSelectedConference] = useState("East");

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const response = await fetch("https://api.sportsdata.io/v3/nba/scores/json/teams", {
          headers: {
            "Ocp-Apim-Subscription-Key": "YOUR_API_KEY", // Replace with your API key
          },
        });
        const data = await response.json();

        // Process the data to separate East and West
        const east = data.filter((team: any) => team.Conference === "East");
        const west = data.filter((team: any) => team.Conference === "West");

        setTeams({ East: east, West: west });
      } catch (error) {
        console.error("Error fetching teams:", error);
      }
    };

    fetchTeams();
  }, []);

  const conferenceTeams = teams[selectedConference] || [];

  return (
    <div className="nba-teams-container">
      <div className="tabs">
        <button
          className={`tab ${selectedConference === "East" ? "active" : ""}`}
          onClick={() => setSelectedConference("East")}
        >
          East
        </button>
        <button
          className={`tab ${selectedConference === "West" ? "active" : ""}`}
          onClick={() => setSelectedConference("West")}
        >
          West
        </button>
      </div>
      <div className="teams-grid">
        {conferenceTeams.map((team) => (
          <NBATeamCard
            key{team.TeamID}
            name={team.Name}
            logo={team.WikipediaLogoUrl}
            leaders={{
              PPG: "N/A" 
              RPG: "N/A" 
              APG: "N/A" 
            }}
        ))}
      </div>
    </div>
  );
};

export default NBA;