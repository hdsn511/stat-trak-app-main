// src/pages/Home/home.tsx
import React from "react";
import Trends from "../../components/Home/Trends";
import "./home.scss";

const Home: React.FC = () => {
  return (
    <div className="home-page">
      {/* Hero Section */}
      <div className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">
            Track <span className="highlight">Hot Streaks</span> & 
            <span className="highlight"> Betting Opportunities</span>
          </h1>
          <p className="hero-subtitle">
            Real-time player trends, statistical analysis, and data-driven betting insights 
            across NFL, NBA, NHL, and MLB
          </p>
        </div>
      </div>

      {/* Main Trends Component with Betting Insights */}
      <Trends />
      
      {/* Quick Stats Grid */}
      <div className="quick-stats-section">
        <h2 className="section-title">Today's Highlights</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">47</div>
            <div className="stat-label">Active Streaks</div>
            <div className="stat-desc">Players on hot streaks</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">23</div>
            <div className="stat-label">High Confidence</div>
            <div className="stat-desc">Betting recommendations</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">156</div>
            <div className="stat-label">Milestones</div>
            <div className="stat-desc">Career achievements tracked</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">89%</div>
            <div className="stat-label">Accuracy</div>
            <div className="stat-desc">Last 30 days predictions</div>
          </div>
        </div>
      </div>
      
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