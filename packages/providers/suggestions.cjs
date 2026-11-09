function createSuggestionProvider() {
  return {
    suggest(text) {
      const input = String(text || '');
      return {
        text: input ? `Consider explaining: ${input.trim().replace(/\s+/g, ' ')}` : '',
        source: 'local',
      };
    },
  };
}

module.exports = { createSuggestionProvider };
