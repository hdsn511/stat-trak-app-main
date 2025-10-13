import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './playerdetailview.scss';

interface PlayerDetailState {
  player: any;
  filters: any;
}

interface CustomFilters {
  stat: string;
  threshold: number;
  games: string;
  vsTeam: string;
  season: string;
}

const PlayerDetailView: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { player, filters: initialFilters } = location.state as PlayerDetailState;

  const [customFilters, setCustomFilters] = useState<CustomFilters>({
    stat: initialFilters.stat,
    threshold: initialFilters.value,
    games: initialFilters.games,
    vsTeam: '',
    season: '2024-25'
  });

  // Mock extended game data with opponents
  const extendedGameData = useMemo(() => [
    { game: 1, stat: 28, opponent: 'BOS', date: '2024-01-15' },
    { game: 2, stat: 31, opponent: 'MIA', date: '2024-01-17' },
    { game: 3, stat: 24, opponent: 'NYK', date: '2024-01-19' },
    { game: 4, stat: 27, opponent: 'PHI', date: '2024-01-21' },
    { game: 5, stat: 29, opponent: 'BRK', date: '2024-01-23' },
    { game: 6, stat: 33, opponent: 'MIL', date: '2024-01-25' },
    { game: 7, stat: 25, opponent: 'CHI', date: '2024-01-27' },
    { game: 8, stat: 30, opponent: 'ATL', date: '2024-01-29' },
    { game: 9, stat: 26, opponent: 'ORL', date: '2024-01-31' },
    { game: 10, stat: 32, opponent: 'WAS', date: '2024-02-02' },
  ], []);

  const availableStats = ['Pts', 'Reb', 'Ast', 'Pts+Reb+Ast','Pts+Reb','Pts+Ast','Reb+Ast','3PM', 'STL', 'BLK'];
  const gameOptions = ['L3', 'L5', 'L10', 'L15', 'L20'];
  const seasons = ['2024-25', '2023-24', '2022-23'];
  const teams = ['BOS', 'MIA', 'NYK', 'PHI', 'BRK', 'MIL', 'CHI', 'ATL', 'ORL', 'WAS'];

  // Filter and process game data
  const processedData = useMemo(() => {
    let data = [...extendedGameData];
    
    // Filter by opponent if selected
    if (customFilters.vsTeam) {
      data = data.filter(game => game.opponent === customFilters.vsTeam);
    }
    
    // Get recent games based on selection
    const gamesCount = parseInt(customFilters.games.substring(1));
    data = data.slice(-gamesCount);
    
    return data;
  }, [customFilters, extendedGameData]);

  const BarChart = () => {
    const maxValue = Math.max(...processedData.map(g => g.stat));
    
    return (
      <div className="bar-chart-container">
        <div className="chart-header">
          <h3>{customFilters.stat} Over {customFilters.games} Games</h3>
          <div className="threshold-line-info">
            Threshold: {customFilters.threshold}
          </div>
        </div>
        
        <div className="chart-area">
          <div className="y-axis">
            {[maxValue, Math.floor(maxValue * 0.75), Math.floor(maxValue * 0.5), Math.floor(maxValue * 0.25), 0].map(value => (
              <div key={value} className="y-tick">{value}</div>
            ))}
          </div>
          
          <div className="chart-bars">
            <div 
              className="threshold-line" 
              style={{ bottom: `${(customFilters.threshold / maxValue) * 100}%` }}
            >
              <span className="threshold-label">{customFilters.threshold}</span>
            </div>
            
            {processedData.map((game, index) => (
              <div key={index} className="bar-container">
                <div
                  className={`bar ${
                    game.stat > customFilters.threshold 
                      ? 'over' 
                      : game.stat === customFilters.threshold 
                        ? 'push' 
                        : 'under'
                  }`}
                  style={{ height: `${(game.stat / maxValue) * 100}%` }}
                  title={`Game ${game.game}: ${game.stat} vs ${game.opponent}`}
                >
                  <span className="bar-value">{game.stat}</span>
                </div>
                <div className="x-label">
                  <div className="game-number">G{game.game}</div>
                  <div className="opponent">vs {game.opponent}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-color over"></div>
            <span>Over ({processedData.filter(g => g.stat > customFilters.threshold).length})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color push"></div>
            <span>Push ({processedData.filter(g => g.stat === customFilters.threshold).length})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color under"></div>
            <span>Under ({processedData.filter(g => g.stat < customFilters.threshold).length})</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="player-detail-page">
      <div className="page-header">
        <button 
          className="back-button"
          onClick={() => navigate('/trend-finder')}
        >
          <ArrowLeft size={20} />
          Back to Trend Finder
        </button>
        
        <div className="player-info">
          <div className="player-avatar-large">
            {player.name.split(' ').map((n: string) => n[0]).join('')}
          </div>
          <div className="player-details">
            <h1>{player.name}</h1>
            <div className="player-meta">
              <span 
                className="team-indicator"
                style={{ backgroundColor: player.teamColors.primary }}
              />
              {player.team} • {player.position}
            </div>
          </div>
        </div>
      </div>

      {/* Custom Filters */}
      <div className="custom-filters-container">
        <h3>Customize Analysis</h3>
        
        <div className="filters-grid">
          <div className="filter-group">
            <label>Stat:</label>
            <div className="filter-options">
              {availableStats.map(stat => (
                <button
                  key={stat}
                  className={`filter-btn ${customFilters.stat === stat ? 'active' : ''}`}
                  onClick={() => setCustomFilters({ ...customFilters, stat })}
                >
                  {stat}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Line:</label>
            <input
              type="number"
              className="threshold-input"
              value={customFilters.threshold}
              onChange={(e) => setCustomFilters({ ...customFilters, threshold: Number(e.target.value) })}
            />
          </div>

          <div className="filter-group">
            <label>Games:</label>
            <div className="filter-options">
              {gameOptions.map(games => (
                <button
                  key={games}
                  className={`filter-btn ${customFilters.games === games ? 'active' : ''}`}
                  onClick={() => setCustomFilters({ ...customFilters, games })}
                >
                  {games}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>VS Team (Optional):</label>
            <div className="filter-options">
              <button
                className={`filter-btn ${customFilters.vsTeam === '' ? 'active' : ''}`}
                onClick={() => setCustomFilters({ ...customFilters, vsTeam: '' })}
              >
                All
              </button>
              {teams.map(team => (
                <button
                  key={team}
                  className={`filter-btn ${customFilters.vsTeam === team ? 'active' : ''}`}
                  onClick={() => setCustomFilters({ ...customFilters, vsTeam: team })}
                >
                  {team}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Season:</label>
            <div className="filter-options">
              {seasons.map(season => (
                <button
                  key={season}
                  className={`filter-btn ${customFilters.season === season ? 'active' : ''}`}
                  onClick={() => setCustomFilters({ ...customFilters, season })}
                >
                  {season}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="chart-section">
        <BarChart />
      </div>

      {/* Stats Summary */}
      <div className="stats-summary">
        <div className="summary-card">
          <div className="summary-title">Performance Summary</div>
          <div className="summary-stats">
            <div className="stat-item">
              <span className="stat-label">Hit Rate:</span>
              <span className="stat-value">
                {Math.round((processedData.filter(g => g.stat >= customFilters.threshold).length / processedData.length) * 100)}%
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Average:</span>
              <span className="stat-value">
                {(processedData.reduce((sum, g) => sum + g.stat, 0) / processedData.length).toFixed(1)}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Best Game:</span>
              <span className="stat-value">
                {Math.max(...processedData.map(g => g.stat))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerDetailView;