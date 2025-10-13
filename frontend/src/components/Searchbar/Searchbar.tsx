import { Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import "./searchbar.scss";

interface SearchbarHeaderProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
}

const SearchbarHeader = ({
  onSearch,
  placeholder = "Search Teams or Players",
}: SearchbarHeaderProps) => {
  // Mock data - replace with API call later
  const suggestions = useMemo(
    () => [
      "LeBron James",
      "Stephen Curry",
      "Kevin Durant",
      "Giannis Antetokounmpo",
      "Luka Dončić",
      "Nikola Jokić",
      "Joel Embiid",
      "Jayson Tatum",
      "James Harden",
      "Anthony Davis",
      "Los Angeles Lakers",
      "Golden State Warriors",
      "Boston Celtics",
      "Miami Heat",
      "Milwaukee Bucks",
    ],
    []
  );

  const [input, setInput] = useState("");
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Memoized filtering
  const getFilteredSuggestions = useCallback(
    (value: string) => {
      if (value.trim() === "") return [];

      return suggestions.filter((suggestion) =>
        suggestion.toLowerCase().includes(value.toLowerCase())
      );
    },
    [suggestions]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInput(value);

      const matches = getFilteredSuggestions(value);
      setFilteredSuggestions(matches);
      setShowSuggestions(matches.length > 0);
      setHighlightIndex(-1);
    },
    [getFilteredSuggestions]
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      setInput(suggestion);
      setFilteredSuggestions([]);
      setShowSuggestions(false);
      setHighlightIndex(-1);

      onSearch?.(suggestion);
      inputRef.current?.focus();
    },
    [onSearch]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev < filteredSuggestions.length - 1 ? prev + 1 : prev
          );
          break;

        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;

        case "Enter":
          e.preventDefault();
          if (highlightIndex >= 0 && filteredSuggestions[highlightIndex]) {
            handleSuggestionClick(filteredSuggestions[highlightIndex]);
          } else if (input.trim()) {
            setShowSuggestions(false);
            onSearch?.(input.trim());
          }
          break;

        case "Escape":
          setShowSuggestions(false);
          setHighlightIndex(-1);
          inputRef.current?.blur();
          break;
      }
    },
    [
      showSuggestions,
      highlightIndex,
      filteredSuggestions,
      handleSuggestionClick,
      input,
      onSearch,
    ]
  );

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setShowSuggestions(false);
      setHighlightIndex(-1);
    }, 150);
  }, []);

  const handleFocus = useCallback(() => {
    if (filteredSuggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [filteredSuggestions.length]);

  const handleSearchClick = useCallback(() => {
    if (input.trim()) {
      onSearch?.(input.trim());
      setShowSuggestions(false);
    }
  }, [input, onSearch]);

  return (
    <div className="searchbar-header-container">
      <div
        className="search-input-wrapper"
        role="combobox"
        aria-expanded={showSuggestions}
      >
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder={placeholder}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
          aria-label="Search for players, teams, or sports"
          aria-autocomplete="list"
          aria-activedescendant={
            highlightIndex >= 0 ? `suggestion-${highlightIndex}` : undefined
          }
        />

        <button
          className="search-icon-button"
          onClick={handleSearchClick}
          aria-label="Search"
          type="button"
        >
          <Search size={20} />
        </button>

        {showSuggestions && (
          <ul
            className="suggestions-dropdown"
            role="listbox"
            aria-label="Search suggestions"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`suggestion-${index}`}
                className={`suggestion-item ${
                  highlightIndex === index ? "highlighted" : ""
                }`}
                role="option"
                aria-selected={highlightIndex === index}
                onClick={() => handleSuggestionClick(suggestion)}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SearchbarHeader;
