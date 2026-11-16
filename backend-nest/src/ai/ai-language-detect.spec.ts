import { detectQuestionLocale } from './ai-language-detect';

describe('detectQuestionLocale', () => {
    it.each([
        ['Qual é a minha maior perda?', 'en', 'pt'],
        ['quanto ganhei esta semana', 'en', 'pt'],
        ['Obrigado pela análise', 'en', 'pt'],
        ['What is my biggest loss?', 'pt', 'en'],
        ['how many trades did I take this week', 'pt', 'en'],
        ['Thanks, show me my best strategy', 'pt', 'en'],
    ])('"%s" with UI %s -> %s', (text, ui, expected) => {
        expect(detectQuestionLocale(text, ui as 'pt' | 'en')).toBe(expected);
    });

    it.each([['ok'], ['EURUSD'], ['?'], ['']])('keeps the UI locale for ambiguous "%s"', (text) => {
        expect(detectQuestionLocale(text, 'pt')).toBe('pt');
        expect(detectQuestionLocale(text, 'en')).toBe('en');
    });
});
