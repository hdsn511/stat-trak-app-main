import { Route, Routes } from "react-router-dom";
import Header from "./components/Header/Header";
import SearchbarHeader from "./components/Searchbar/Searchbar";
import SideBar from "./components/Sidebar/Sidebar";
import Home from "./pages/Home/Home";
import TrendFinder from "./components/TrendFinder/TrendFinder";
import PlayerDetailView from "./components/TrendFinder/PlayerDetailView";
import "./Styles/App.scss";

const App = () => {
  const navLinks = [
    { label: "NBA", href: "#" },
    { label: "NFL", href: "#" },
    { label: "NHL", href: "#" },
    { label: "MLB", href: "#" },
  ];

  const trendFinderLink = { label: "Trend Finder", href: "/trend-finder" };
  const title = { stat: "Stat", trak: "Trak", sports: "Sports" };

  const handleSearch = (query: string) => {
    console.log("Searching for:", query);
    // TODO: Implement search functionality
    // - Navigate to search results page
    // - Filter data based on query
    // - Show player/team stats
    // - Display betting info if applicable
  };

  return (
    <div className="app">
      <Header
        title={title}
        navLinks={navLinks}
        allLeaguesLink={trendFinderLink}
      />

      <SearchbarHeader
        onSearch={handleSearch}
        placeholder="Search Teams or Players"
      />

      <div className="layout d-flex">
        <SideBar />

        <main className="main flex-grow-1 ms-auto p-3">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/trend-finder" element={<TrendFinder />} />
            <Route path="/trend-finder/player/:id" element={<PlayerDetailView />} />
            {/* Future routes for your sports betting features */}
            {/* <Route path="/player/:id" element={<PlayerStats />} /> */}
            {/* <Route path="/picks" element={<PopularPicks />} /> */}
            {/* <Route path="/recommendations" element={<BettingRecommendations />} /> */}
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default App;