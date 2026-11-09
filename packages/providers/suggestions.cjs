function createSuggestionProvider() {
  return {
    suggest(text) {
      const input = String(text || '');
      const normalized = input.trim().replace(/\s+/g, ' ');
      return {
        text: normalized ? `Consider explaining: ${normalized}` : '',
        source: 'local',
      };
    },
  };
}

module.exports = { createSuggestionProvider };
