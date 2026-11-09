function createSuggestionProvider() {
  return {
    suggest(text) {
      const input = String(text || '');
      return {
        text: input ? 'Consider explaining the deterministic local flow.' : '',
        source: 'local',
      };
    },
  };
}

module.exports = { createSuggestionProvider };
