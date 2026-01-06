// src/pages/Home/home.tsx
import React from "react";
import Trends from "../../components/Home/Trends";
import TrendFinder from "../../components/TrendFinder/TrendFinder";
import "./home.scss";

const Home: React.FC = () => {
  return (
    <div className="home-page">

      {/* Main Trends Component with Betting Insights */}
      <TrendFinder />

      
      {/* Future sections can be added here */}
      {/* <LiveOdds /> */}
      {/* <PopularPicks /> */}
      {/* <BettingInsights /> */}
      {/* <PlayerComparisons /> */}
      {/* <InjuryReports /> */}
      {/* <WeatherUpdates /> */}
    </div>
  );
};

export default Home;
