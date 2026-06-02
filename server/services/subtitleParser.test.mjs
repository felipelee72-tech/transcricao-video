import assert from 'node:assert/strict';
import test from 'node:test';
import { subtitleFileToPlainText } from './subtitleParser.js';

test('remove cabecalhos VTT e linhas duplicadas consecutivas', () => {
  const input = `WEBVTT
Kind: captions
Language: pt

00:00:00.000 --> 00:00:02.000
Quantas profissões asiás vão eliminar? E
Quantas profissões asiás vão eliminar? E

00:00:02.000 --> 00:00:04.000
os programadores serão desempregados por
os programadores serão desempregados por
`;

  const result = subtitleFileToPlainText(input);

  assert.equal(
    result,
    'Quantas profissões asiás vão eliminar? E os programadores serão desempregados por',
  );
});

test('preserva repeticao de palavras dentro da mesma linha', () => {
  const input = `WEBVTT
Kind: captions
Language: pt

00:00:00.000 --> 00:00:02.000
A inteligência artificial, ela tá tá ela
A inteligência artificial, ela tá tá ela

00:00:02.000 --> 00:00:04.000
saiu, né, do do terreno de ser uma
saiu, né, do do terreno de ser uma
`;

  const result = subtitleFileToPlainText(input);

  assert.equal(
    result,
    'A inteligência artificial, ela tá tá ela saiu, né, do do terreno de ser uma',
  );
});

test('remove tags VTT e timestamps inline', () => {
  const input = `WEBVTT

00:00:01.000 --> 00:00:03.000
<c>Olá</c> <00:00:02.000>mundo</00:00:02.000>
Olá mundo
`;

  const result = subtitleFileToPlainText(input);

  assert.equal(result, 'Olá mundo');
});

test('compativel com SRT', () => {
  const input = `1
00:00:00,000 --> 00:00:02,000
Primeira linha
Primeira linha

2
00:00:02,000 --> 00:00:04,000
Segunda linha
Segunda linha
`;

  const result = subtitleFileToPlainText(input);

  assert.equal(result, 'Primeira linha Segunda linha');
});

test('ignora repeticao na janela curta mesmo nao consecutiva', () => {
  const input = `WEBVTT

00:00:00.000 --> 00:00:01.000
Linha A

00:00:01.000 --> 00:00:02.000
Linha B

00:00:02.000 --> 00:00:03.000
Linha C

00:00:03.000 --> 00:00:04.000
Linha A
`;

  const result = subtitleFileToPlainText(input);

  assert.equal(result, 'Linha A Linha B Linha C');
});
