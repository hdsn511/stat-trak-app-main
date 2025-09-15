const API_BASE_URL = 'http://localhost:3000/api';

export interface Player {
  id: number;
  name: string;
  team: string;
  position: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export const api = {
  // Fetch players from backend
  getPlayers: async (): Promise<Player[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/players`);
      const result: ApiResponse<Player[]> = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error fetching players:', error);
      throw error;
    }
  },

  // Health check
  getHealth: async () => {
    try {
      const response = await fetch('http://localhost:3000/health');
      return await response.json();
    } catch (error) {
      console.error('Error checking health:', error);
      throw error;
    }
  }
};