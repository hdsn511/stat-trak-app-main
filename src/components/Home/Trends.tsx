// src/components/Trends/Trends.tsx
import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Flame, Zap, Trophy, BarChart3 } from 'lucide-react';
import './trends.scss';

interface PlayerTrend {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  sport: 'NFL' | 'NBA' | 'NHL' | 'MLB';
  trendType: 'streak' | 'slump' | 'career';
  category: string;
  description: string;
  currentStreak: number;
  threshold: number;
  gamesPlayed: number;
  isActive: boolean;
  nextGame: {
    opponent: string;
    date: string;
    homeAway: 'home' | 'away';
  };
  bettingRelevance: {
    prop: string;
    line: number;
    recommendation: 'over' | 'under' | 'avoid';
    confidence: 'high' | 'medium' | 'low';
  };
  statValue?: number;
  careerRank?: number;
}

type Sport = 'NFL' | 'NBA' | 'NHL' | 'MLB';

const Trends: React.FC = () => {
  const [trends, setTrends] = useState<PlayerTrend[]>([]);
  const [selectedSport, setSelectedSport] = useState<Sport>('NFL');
  const [loading, setLoading] = useState(true);

  // Mock data - replace with actual API calls
  useEffect(() => {
    const mockTrends: PlayerTrend[] = [
      // HOT STREAKS
      {
        id: '1',
        playerId: 'josh-allen',
        playerName: 'Josh Allen',
        team: 'BUF',
        position: 'QB',
        sport: 'NFL',
        trendType: 'streak',
        category: 'passing_yards',
        description: '6 consecutive games with 300+ passing yards',
        currentStreak: 6,
        threshold: 300,
        gamesPlayed: 6,
        isActive: true,
        nextGame: { opponent: 'MIA', date: '2025-01-19', homeAway: 'home' },
        bettingRelevance: { prop: 'Passing Yards', line: 289.5, recommendation: 'over', confidence: 'high' },
        statValue: 347
      },
      {
        id: '2',
        playerId: 'luka-doncic',
        playerName: 'Luka Dončić',
        team: 'DAL',
        position: 'PG',
        sport: 'NBA',
        trendType: 'streak',
        category: 'points',
        description: '8 consecutive games with 30+ points',
        currentStreak: 8,
        threshold: 30,
        gamesPlayed: 8,
        isActive: true,
        nextGame: { opponent: 'BOS', date: '2025-01-15', homeAway: 'away' },
        bettingRelevance: { prop: 'Points', line: 32.5, recommendation: 'over', confidence: 'high' },
        statValue: 35.2
      },
      {
        id: '3',
        playerId: 'connor-mcdavid',
        playerName: 'Connor McDavid',
        team: 'EDM',
        position: 'C',
        sport: 'NHL',
        trendType: 'streak',
        category: 'points',
        description: '12 consecutive games with at least 1 point',
        currentStreak: 12,
        threshold: 1,
        gamesPlayed: 12,
        isActive: true,
        nextGame: { opponent: 'CGY', date: '2025-01-16', homeAway: 'away' },
        bettingRelevance: { prop: 'Points', line: 1.5, recommendation: 'over', confidence: 'high' },
        statValue: 2.1
      },
      {
        id: '4',
        playerId: 'stephen-curry',
        playerName: 'Stephen Curry',
        team: 'GSW',
        position: 'PG',
        sport: 'NBA',
        trendType: 'streak',
        category: 'threes',
        description: '15 consecutive games with 3+ three-pointers',
        currentStreak: 15,
        threshold: 3,
        gamesPlayed: 15,
        isActive: true,
        nextGame: { opponent: 'LAL', date: '2025-01-15', homeAway: 'away' },
        bettingRelevance: { prop: '3-Pointers Made', line: 4.5, recommendation: 'over', confidence: 'high' },
        statValue: 5.8
      },
      {
        id: '5',
        playerId: 'derrick-henry',
        playerName: 'Derrick Henry',
        team: 'TEN',
        position: 'RB',
        sport: 'NFL',
        trendType: 'streak',
        category: 'rushing_yards',
        description: '5 consecutive games with 100+ rushing yards',
        currentStreak: 5,
        threshold: 100,
        gamesPlayed: 5,
        isActive: true,
        nextGame: { opponent: 'IND', date: '2025-01-19', homeAway: 'away' },
        bettingRelevance: { prop: 'Rushing Yards', line: 95.5, recommendation: 'over', confidence: 'medium' },
        statValue: 134
      },

      // SLUMPS
      {
        id: '6',
        playerId: 'cooper-kupp',
        playerName: 'Cooper Kupp',
        team: 'LAR',
        position: 'WR',
        sport: 'NFL',
        trendType: 'slump',
        category: 'receiving_yards',
        description: '4 consecutive games under 75 receiving yards',
        currentStreak: 4,
        threshold: 75,
        gamesPlayed: 4,
        isActive: false,
        nextGame: { opponent: 'SEA', date: '2025-01-19', homeAway: 'home' },
        bettingRelevance: { prop: 'Receiving Yards', line: 68.5, recommendation: 'under', confidence: 'medium' },
        statValue: 52
      },
      {
        id: '7',
        playerId: 'giannis-antetokounmpo',
        playerName: 'Giannis Antetokounmpo',
        team: 'MIL',
        position: 'PF',
        sport: 'NBA',
        trendType: 'slump',
        category: 'field_goal_pct',
        description: '6 games shooting under 50% from field',
        currentStreak: 6,
        threshold: 50,
        gamesPlayed: 6,
        isActive: false,
        nextGame: { opponent: 'PHX', date: '2025-01-15', homeAway: 'home' },
        bettingRelevance: { prop: 'Points', line: 29.5, recommendation: 'under', confidence: 'low' },
        statValue: 47.2
      },
      {
        id: '8',
        playerId: 'sidney-crosby',
        playerName: 'Sidney Crosby',
        team: 'PIT',
        position: 'C',
        sport: 'NHL',
        trendType: 'slump',
        category: 'goals',
        description: '7 consecutive games without a goal',
        currentStreak: 7,
        threshold: 1,
        gamesPlayed: 7,
        isActive: false,
        nextGame: { opponent: 'WSH', date: '2025-01-16', homeAway: 'home' },
        bettingRelevance: { prop: 'Goals', line: 0.5, recommendation: 'under', confidence: 'medium' },
        statValue: 0
      },
      {
        id: '9',
        playerId: 'russell-westbrook',
        playerName: 'Russell Westbrook',
        team: 'LAC',
        position: 'PG',
        sport: 'NBA',
        trendType: 'slump',
        category: 'three_point_pct',
        description: '8 games shooting under 25% from three',
        currentStreak: 8,
        threshold: 25,
        gamesPlayed: 8,
        isActive: false,
        nextGame: { opponent: 'DEN', date: '2025-01-15', homeAway: 'away' },
        bettingRelevance: { prop: '3-Pointers Made', line: 1.5, recommendation: 'under', confidence: 'high' },
        statValue: 18.2
      },

      // CAREER HIGHS
      {
        id: '10',
        playerId: 'aaron-judge',
        playerName: 'Aaron Judge',
        team: 'NYY',
        position: 'OF',
        sport: 'MLB',
        trendType: 'career',
        category: 'home_runs',
        description: '26 home runs away from 300 career milestone',
        currentStreak: 2,
        threshold: 1,
        gamesPlayed: 5,
        isActive: true,
        nextGame: { opponent: 'BOS', date: '2025-04-01', homeAway: 'home' },
        bettingRelevance: { prop: 'Home Runs', line: 0.5, recommendation: 'over', confidence: 'medium' },
        statValue: 274,
        careerRank: 2
      },
      {
        id: '11',
        playerId: 'lebron-james',
        playerName: 'LeBron James',
        team: 'LAL',
        position: 'SF',
        sport: 'NBA',
        trendType: 'career',
        category: 'points',
        description: 'All-time scoring leader with 40,474 points',
        currentStreak: 1,
        threshold: 1,
        gamesPlayed: 1,
        isActive: true,
        nextGame: { opponent: 'GSW', date: '2025-01-15', homeAway: 'home' },
        bettingRelevance: { prop: 'Points', line: 24.5, recommendation: 'over', confidence: 'medium' },
        statValue: 40474,
        careerRank: 1
      },
      {
        id: '12',
        playerId: 'tom-brady',
        playerName: 'Tom Brady',
        team: 'TB',
        position: 'QB',
        sport: 'NFL',
        trendType: 'career',
        category: 'passing_yards',
        description: 'All-time leader with 89,214 career passing yards',
        currentStreak: 0,
        threshold: 1,
        gamesPlayed: 0,
        isActive: false,
        nextGame: { opponent: 'N/A', date: 'Retired', homeAway: 'home' },
        bettingRelevance: { prop: 'Legacy', line: 0, recommendation: 'avoid', confidence: 'high' },
        statValue: 89214,
        careerRank: 1
      },
      {
        id: '13',
        playerId: 'wayne-gretzky',
        playerName: 'Wayne Gretzky',
        team: 'EDM',
        position: 'C',
        sport: 'NHL',
        trendType: 'career',
        category: 'points',
        description: 'All-time points leader with 2,857 career points',
        currentStreak: 0,
        threshold: 1,
        gamesPlayed: 0,
        isActive: false,
        nextGame: { opponent: 'N/A', date: 'Retired', homeAway: 'home' },
        bettingRelevance: { prop: 'Legacy', line: 0, recommendation: 'avoid', confidence: 'high' },
        statValue: 2857,
        careerRank: 1
      },
      {
        id: '14',
        playerId: 'nikola-jokic',
        playerName: 'Nikola Jokić',
        team: 'DEN',
        position: 'C',
        sport: 'NBA',
        trendType: 'career',
        category: 'triple_doubles',
        description: '3rd most triple-doubles among centers all-time',
        currentStreak: 2,
        threshold: 1,
        gamesPlayed: 3,
        isActive: true,
        nextGame: { opponent: 'UTA', date: '2025-01-15', homeAway: 'home' },
        bettingRelevance: { prop: 'Rebounds', line: 12.5, recommendation: 'over', confidence: 'high' },
        statValue: 147,
        careerRank: 3
      }
    ];

    setTimeout(() => {
      setTrends(mockTrends);
      setLoading(false);
    }, 1000);
  }, []);

  const getTrendIcon = (trendType: string) => {
    switch (trendType) {
      case 'streak':
        return <Flame className="trend-icon streak" />;
      case 'slump':
        return <TrendingDown className="trend-icon slump" />;
      case 'career':
        return <Trophy className="trend-icon career" />;
      default:
        return <BarChart3 className="trend-icon default" />;
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'confidence-high';
      case 'medium': return 'confidence-medium';
      case 'low': return 'confidence-low';
      default: return 'confidence-medium';
    }
  };

  // Filter trends by sport and type
  const getFilteredTrends = (type: 'streak' | 'slump' | 'career') => {
    return trends.filter(trend => 
      trend.sport === selectedSport && trend.trendType === type
    );
  };

  const hotStreaks = getFilteredTrends('streak');
  const slumps = getFilteredTrends('slump');
  const careerHighs = getFilteredTrends('career');

  if (loading) {
    return (
      <div className="trends-container">
        <div className="trends-header">
          <h2 className="trends-title">Player Trends & Betting Insights</h2>
          <p className="trends-subtitle">Loading trends...</p>
        </div>
        <div className="loading-container">
          <div className="loading-columns">
            {[1, 2, 3].map((col) => (
              <div key={col} className="loading-column">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="loading-item"></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trends-container">
      <div className="trends-header">
        <h2 className="trends-title">
          <BarChart3 className="header-icon" />
          Player Trends & Betting Insights
        </h2>
        <p className="trends-subtitle">Track hot streaks, slumps, and career milestones</p>
      </div>

      {/* Sport Selection */}
      <div className="trends-controls">
        <div className="control-group">
          <label className="control-label">Sport</label>
          <div className="sport-tabs">
            {(['NFL', 'NBA', 'NHL', 'MLB'] as Sport[]).map((sport) => (
              <button
                key={sport}
                className={`sport-tab ${selectedSport === sport ? 'active' : ''}`}
                onClick={() => setSelectedSport(sport)}
              >
                {sport}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Three Column Layout */}
      <div className="trends-columns">
        {/* Hot Streaks Column */}
        <div className="trend-column hot-streaks">
          <div className="column-header">
            <Flame className="column-icon" />
            <h3 className="column-title">Hot Streaks</h3>
            <span className="column-count">{hotStreaks.length}</span>
          </div>
          <div className="column-content">
            {hotStreaks.map((trend) => (
              <div key={trend.id} className="player-card streak-card">
                <div className="player-info">
                  <div className="player-name">{trend.playerName}</div>
                  <div className="player-meta">{trend.team} • {trend.position}</div>
                </div>
                <div className="trend-details">
                  <div className="trend-stat">
                    <span className="stat-value">{trend.statValue}</span>
                    <span className="stat-label">{trend.bettingRelevance.prop}</span>
                  </div>
                  <div className="trend-description">{trend.description}</div>
                </div>
                <div className="betting-section">
                  <div className="betting-line">
                    <span className="line-label">Line: {trend.bettingRelevance.line}</span>
                    <span className={`recommendation ${trend.bettingRelevance.recommendation}`}>
                      {trend.bettingRelevance.recommendation.toUpperCase()}
                    </span>
                  </div>
                  <div className={`confidence ${getConfidenceColor(trend.bettingRelevance.confidence)}`}>
                    {trend.bettingRelevance.confidence} confidence
                  </div>
                </div>
                <div className="next-game">
                  <span>vs {trend.nextGame.opponent}</span>
                  <span className="venue">{trend.nextGame.homeAway === 'home' ? '🏠' : '✈️'}</span>
                </div>
              </div>
            ))}
            {hotStreaks.length === 0 && (
              <div className="no-data">No hot streaks for {selectedSport}</div>
            )}
          </div>
        </div>

        {/* Slumps Column */}
        <div className="trend-column slumps">
          <div className="column-header">
            <TrendingDown className="column-icon" />
            <h3 className="column-title">Slumps</h3>
            <span className="column-count">{slumps.length}</span>
          </div>
          <div className="column-content">
            {slumps.map((trend) => (
              <div key={trend.id} className="player-card slump-card">
                <div className="player-info">
                  <div className="player-name">{trend.playerName}</div>
                  <div className="player-meta">{trend.team} • {trend.position}</div>
                </div>
                <div className="trend-details">
                  <div className="trend-stat">
                    <span className="stat-value">{trend.statValue}</span>
                    <span className="stat-label">{trend.bettingRelevance.prop}</span>
                  </div>
                  <div className="trend-description">{trend.description}</div>
                </div>
                <div className="betting-section">
                  <div className="betting-line">
                    <span className="line-label">Line: {trend.bettingRelevance.line}</span>
                    <span className={`recommendation ${trend.bettingRelevance.recommendation}`}>
                      {trend.bettingRelevance.recommendation.toUpperCase()}
                    </span>
                  </div>
                  <div className={`confidence ${getConfidenceColor(trend.bettingRelevance.confidence)}`}>
                    {trend.bettingRelevance.confidence} confidence
                  </div>
                </div>
                <div className="next-game">
                  <span>vs {trend.nextGame.opponent}</span>
                  <span className="venue">{trend.nextGame.homeAway === 'home' ? '🏠' : '✈️'}</span>
                </div>
              </div>
            ))}
            {slumps.length === 0 && (
              <div className="no-data">No slumps for {selectedSport}</div>
            )}
          </div>
        </div>

        {/* Career Highs Column */}
        <div className="trend-column career-highs">
          <div className="column-header">
            <Trophy className="column-icon" />
            <h3 className="column-title">Career Milestones</h3>
            <span className="column-count">{careerHighs.length}</span>
          </div>
          <div className="column-content">
            {careerHighs.map((trend) => (
              <div key={trend.id} className="player-card career-card">
                <div className="player-info">
                  <div className="player-name">{trend.playerName}</div>
                  <div className="player-meta">{trend.team} • {trend.position}</div>
                </div>
                <div className="trend-details">
                  <div className="trend-stat">
                    <span className="stat-value">
                      {trend.statValue?.toLocaleString()}
                      {trend.careerRank && <span className="rank">#{trend.careerRank}</span>}
                    </span>
                    <span className="stat-label">{trend.bettingRelevance.prop}</span>
                  </div>
                  <div className="trend-description">{trend.description}</div>
                </div>
                {trend.isActive && (
                  <>
                    <div className="betting-section">
                      <div className="betting-line">
                        <span className="line-label">Line: {trend.bettingRelevance.line}</span>
                        <span className={`recommendation ${trend.bettingRelevance.recommendation}`}>
                          {trend.bettingRelevance.recommendation.toUpperCase()}
                        </span>
                      </div>
                      <div className={`confidence ${getConfidenceColor(trend.bettingRelevance.confidence)}`}>
                        {trend.bettingRelevance.confidence} confidence
                      </div>
                    </div>
                    <div className="next-game">
                      <span>vs {trend.nextGame.opponent}</span>
                      <span className="venue">{trend.nextGame.homeAway === 'home' ? '🏠' : '✈️'}</span>
                    </div>
                  </>
                )}
                {!trend.isActive && (
                  <div className="legacy-status">
                    <span className="legacy-label">Legacy Achievement</span>
                  </div>
                )}
              </div>
            ))}
            {careerHighs.length === 0 && (
              <div className="no-data">No career milestones for {selectedSport}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Trends;