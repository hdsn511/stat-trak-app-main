import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import './trendfinder.scss';

interface Player {
  id: string;
  name: string;
  team: string;
  teamColors: { primary: string; secondary: string };
  position: string;
  gameStats: number[];
}

interface FilterState {
  sport: string;
  stat: string;
  value: number;
  games: string;
}

const TrendFinder: React.FC = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>({
    sport: '',
    stat: '',
    value: 0,
    games: ''
  });

  // Mock data for sports and their stats
  const sportsData = {
    NBA: {
      stats: ['PTS', 'REB', 'AST', '3PM', 'STL', 'BLK', 'FGM', 'FTM'],
      players: [
        {
          id: '1',
          name: 'LeBron James',
          team: 'LAL',
          teamColors: { primary: '#552583', secondary: '#FDB927' },
          position: 'SF',
          gameStats: [28, 31, 24, 27, 29, 33, 25, 30, 26, 32]
        },
        {
          id: '2',
          name: 'Stephen Curry',
          team: 'GSW',
          teamColors: { primary: '#1D428A', secondary: '#FFC72C' },
          position: 'PG',
          gameStats: [35, 29, 31, 27, 33, 28, 30, 32, 29, 34]
        },
        {
          id: '3',
          name: 'Giannis Antetokounmpo',
          team: 'MIL',
          teamColors: { primary: '#00471B', secondary: '#EEE1C6' },
          position: 'PF',
          gameStats: [32, 28, 35, 31, 29, 33, 27, 30, 34, 28]
        }
      ]
    },
    NFL: {
      stats: ['PASS_YDS', 'PASS_TD', 'RUSH_YDS', 'RUSH_TD', 'REC', 'REC_YDS', 'REC_TD'],
      players: [
        {
          id: '4',
          name: 'Josh Allen',
          team: 'BUF',
          teamColors: { primary: '#00338D', secondary: '#C60C30' },
          position: 'QB',
          gameStats: [285, 312, 298, 276, 289, 305, 291, 283, 297, 308]
        }
      ]
    },
    NHL: {
      stats: ['GOALS', 'ASSISTS', 'POINTS', 'SHOTS', 'HITS', 'BLOCKS'],
      players: [
        {
          id: '5',
          name: 'Connor McDavid',
          team: 'EDM',
          teamColors: { primary: '#041E42', secondary: '#FF4C00' },
          position: 'C',
          gameStats: [2, 1, 3, 2, 1, 2, 3, 1, 2, 2]
        }
      ]
    },
    MLB: {
      stats: ['HITS', 'HR', 'RBI', 'RUNS', 'SB', 'AVG'],
      players: [
        {
          id: '6',
          name: 'Shohei Ohtani',
          team: 'LAD',
          teamColors: { primary: '#005A9C', secondary: '#EF3E42' },
          position: 'DH',
          gameStats: [3, 2, 1, 2, 3, 2, 1, 3, 2, 2]
        }
      ]
    }
  };

  const gameOptions = ['L3', 'L5', 'L10', 'L15', 'L20'];

  // Make all filters visible; disable later ones until earlier choices are made
  const allStats = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(sportsData).flatMap(sport => sport.stats)
        )
      ),
    []
  );

  const currentStats = filters.sport
    ? sportsData[filters.sport as keyof typeof sportsData].stats
    : [];

  const statDisabled = !filters.sport;
  const valueDisabled = !filters.stat;
  const gamesDisabled = !(filters.value > 0);

  // Filter players based on current filters
  const filteredPlayers = useMemo(() => {
    if (!filters.sport || !filters.stat || !filters.games || filters.value === 0) {
      return [];
    }

    const sportData = sportsData[filters.sport as keyof typeof sportsData];
    if (!sportData) return [];

    const gamesCount = parseInt(filters.games.substring(1));

    return sportData.players.filter(player => {
      const recentGames = player.gameStats.slice(-gamesCount);
      const meetsThreshold = recentGames.filter(stat => stat >= filters.value).length;
      return meetsThreshold >= Math.ceil(gamesCount * 0.6); // At least 60% of games meet threshold
    });
  }, [filters]);

  const handlePlayerClick = (player: Player) => {
    navigate(`/trend-finder/player/${player.id}`, {
      state: { player, filters }
    });
  };

  const MiniBarChart = ({ stats, threshold }: { stats: number[], threshold: number }) => {
    const gamesCount = parseInt(filters.games.substring(1));
    const recentStats = stats.slice(-gamesCount);

    const maxVal = Math.max(...recentStats);
    return (
      <div className="mini-bar-chart">
        {recentStats.map((stat, index) => (
          <div
            key={index}
            className={`bar ${
              threshold === 0
                ? 'neutral'
                : stat > threshold
                ? 'over'
                : stat === threshold
                ? 'push'
                : 'under'
            }`}
            style={{ height: `${Math.max((stat / maxVal) * 100, 10)}%` }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="trend-finder-page">
      <div className="page-header">
        <h1>Trend Finder</h1>
        <p>Discover players and analyze their performance trends</p>
      </div>

      {/* Filters: always visible; later rows disabled until ready */}
      <div className="filter-container">
        {/* Sport Selection */}
        <div className="filter-row">
          <label>Sport:</label>
          <div className="filter-options">
            {Object.keys(sportsData).map(sport => (
              <button
                key={sport}
                className={`filter-btn ${filters.sport === sport ? 'active' : ''}`}
                onClick={() => setFilters({ sport, stat: '', value: 0, games: '' })}
                type="button"
              >
                {sport}
              </button>
            ))}
          </div>
        </div>

        {/* Stat Selection */}
        <div className="filter-row">
          <label>Stat:</label>
          <div className="filter-options">
            {currentStats.map(stat => (
              <button
                key={stat}
                className={`filter-btn ${filters.stat === stat ? 'active' : ''}`}
                onClick={() => setFilters({ ...filters, stat, value: 0, games: '' })}
                type="button"
                disabled={statDisabled}
                aria-disabled={statDisabled}
              >
                {stat}
              </button>
            ))}
          </div>
          
          {!filters.sport && <small className="hint">Select a sport to enable stats</small>}
        </div>

        {/* Value Input */}
        <div className="filter-row">
          <label>Threshold:</label>
          <div className="value-input-container">
            <input
              type="number"
              className="value-input"
              placeholder={valueDisabled ? 'Select a stat first' : 'Enter value...'}
              value={filters.value || ''}
              onChange={(e) =>
                setFilters({ ...filters, value: Number(e.target.value) || 0, games: '' })
              }
              disabled={valueDisabled}
            />
            <span className="value-suffix">+</span>
          </div>
        </div>

        {/* Games Selection */}
        <div className="filter-row">
          <label>Games:</label>
          <div className="filter-options">
            {gameOptions.map(games => (
              <button
                key={games}
                className={`filter-btn ${filters.games === games ? 'active' : ''}`}
                onClick={() => setFilters({ ...filters, games })}
                type="button"
                disabled={gamesDisabled}
                aria-disabled={gamesDisabled}
              >
                {games}
              </button>
            ))}
          </div>
          {gamesDisabled && <small className="hint">Enter a threshold to enable games</small>}
        </div>
      </div>

      {/* Results */}
      {filteredPlayers.length > 0 && (
        <div className="results-container">
          <div className="results-header">
            <h3>
              Players with {filters.stat} {filters.value}+ in {filters.games} games
            </h3>
            <span className="results-count">{filteredPlayers.length} players found</span>
          </div>

          <div className="results-list">
            {filteredPlayers.map(player => (
              <div
                key={player.id}
                className="player-result"
                onClick={() => handlePlayerClick(player)}
              >
                <div className="player-info">
                  <div className="player-avatar">
                    {player.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="player-details">
                    <div className="player-name">{player.name}</div>
                    <div className="player-team-info">
                      <span
                        className="team-indicator"
                        style={{ backgroundColor: player.teamColors.primary }}
                      />
                      {player.team} • {player.position}
                    </div>
                  </div>
                </div>

                <div className="player-stats">
                  <MiniBarChart
                    stats={player.gameStats}
                    threshold={filters.value}
                  />
                </div>

                <div className="stat-average">
                  Avg:{' '}
                  {(
                    player.gameStats
                      .slice(-parseInt(filters.games.substring(1)))
                      .reduce((sum, stat) => sum + stat, 0) /
                    parseInt(filters.games.substring(1))
                  ).toFixed(1)}{' '}
                  {filters.stat}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filters.sport && filters.stat && filters.value > 0 && filters.games && filteredPlayers.length === 0 && (
        <div className="empty-state">
          <h3>No players found</h3>
          <p>Try adjusting your filters to find more results</p>
        </div>
      )}
    </div>
  );
};

export default TrendFinder;
