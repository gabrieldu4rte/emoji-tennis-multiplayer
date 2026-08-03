# Emoji Tennis Online

Jogo multiplayer de tênis em tempo real, no estilo Pong, no qual os jogadores controlam avatares representados por emojis. A partida ocorre entre dois jogadores conectados simultaneamente pela rede, com sincronização de estado via WebSocket.

## Visão geral

O projeto é composto por um servidor Node.js responsável pelo pareamento de jogadores e pela retransmissão de eventos de jogo, e por um cliente web que concentra toda a lógica de renderização, física da partida e interface. Não há persistência de dados: partidas, salas e placares existem apenas durante a conexão dos jogadores.

## Funcionalidades

- Pareamento automático de dois jogadores em uma sala de jogo.
- Seleção de personagem entre doze emojis disponíveis.
- Movimentação de paddle por teclado, com sincronização em tempo real entre os dois clientes.
- Física de colisão com variação de ângulo e velocidade da bola conforme o ponto de contato com o paddle.
- Efeitos sonoros gerados via Web Audio API, sincronizados entre os dois jogadores.
- Placar com limite de cinco pontos e tela de vitória ao final da partida, decidida e confirmada pelo servidor para os dois jogadores.
- Interface com tema visual próprio, incluindo animações de tela de espera, placar e encerramento de partida.
- Reconexão automática em caso de queda de conexão durante a partida, com aviso ao oponente e período de tolerância antes de encerrar a sala.
- Validação server-side dos eventos recebidos dos clientes, incluindo posição de paddle, posição da bola, placar e efeitos sonoros.

## Tecnologias utilizadas

- Node.js
- Express, para o servidor HTTP e para servir os arquivos estáticos do cliente.
- Socket.IO, para comunicação em tempo real entre servidor e clientes.
- HTML5 Canvas, para renderização gráfica do jogo no navegador.
- Web Audio API, para geração de efeitos sonoros.

## Estrutura do projeto

```
emoji-tennis-multiplayer/
├── package.json        Dependências e script de inicialização do servidor
├── server.js            Servidor Express/Socket.IO: pareamento e retransmissão de eventos
└── public/
    └── index.html       Cliente completo: interface, lógica de jogo e comunicação em tempo real
```

## Requisitos

- Node.js instalado (recomendado a versão LTS mais recente).
- npm, distribuído junto com o Node.js.

## Instalação

Clone o repositório e instale as dependências:

```
npm install
```

## Execução

Para iniciar o servidor:

```
npm start
```

Por padrão, o servidor é iniciado na porta 3000. A porta pode ser alterada por meio da variável de ambiente `PORT`.

Após iniciar o servidor, acesse `http://localhost:3000` no navegador. Para jogar uma partida, é necessário abrir o endereço em duas abas, janelas ou dispositivos distintos, simulando os dois jogadores.

## Como jogar

1. Na tela inicial, escolha um personagem entre os emojis disponíveis.
2. Clique em "Procurar Partida" para entrar na fila de pareamento.
3. Quando um segundo jogador se conectar, a partida começa automaticamente.
4. Controle o paddle utilizando as teclas W e S, ou as setas para cima e para baixo.
5. O primeiro jogador a atingir cinco pontos vence a partida.

## Arquitetura e funcionamento interno

O servidor não simula a física do jogo. Sua responsabilidade se limita a:

- Parear o próximo jogador que se conectar com o jogador que já estiver esperando, criando uma sala identificada pela combinação dos identificadores de socket dos dois jogadores. O pareamento é sequencial (apenas um jogador aguarda pareamento por vez), mas isso não limita o número de salas simultâneas: cada par formado gera uma sala independente, e novas duplas continuam sendo pareadas normalmente enquanto partidas anteriores estão em andamento.
- Validar e retransmitir aos jogadores de uma mesma sala os eventos recebidos: movimentação de paddle, posição da bola, placar e disparo de efeitos sonoros. O servidor confere se o remetente pertence à sala e ao papel (p1 ou p2) que afirma ter, limita a posição do paddle e da bola aos limites da quadra, restringe o emoji escolhido à lista permitida, valida os parâmetros de som e aceita apenas incrementos de placar de um ponto por vez, vindos exclusivamente do jogador que atua como autoridade da física (p1). Ao atingir cinco pontos, o próprio servidor declara o vencedor e notifica os dois jogadores.
- Gerenciar desconexões: ao perder a conexão com um jogador, o servidor avisa o oponente e mantém a sala reservada por um período de tolerância (20 segundos) antes de encerrá-la, permitindo que o jogador se reconecte e retome a partida do ponto em que estava. Se o jogador sair voluntariamente pelo menu, a sala é encerrada de imediato.

A simulação da partida é executada inteiramente no cliente, de forma distribuída entre os dois navegadores:

- O jogador definido como o primeiro da sala é responsável por calcular a física da bola (movimento, colisões e pontuação) e envia essa informação ao oponente a cada quadro.
- O segundo jogador não simula a bola; apenas exibe os dados recebidos do primeiro jogador.
- Cada jogador simula localmente o movimento do seu próprio paddle e envia sua posição ao oponente, sem qualquer reconciliação ou correção no lado receptor.

Essa divisão de responsabilidades implica que a exatidão da física da partida depende inteiramente da conexão do jogador que atua como autoridade da simulação.

## Limitações conhecidas

- A reconexão automática cobre apenas quedas de conexão durante uma partida em andamento, na mesma aba do navegador; se a página for recarregada ou fechada, o estado da partida é perdido e não é possível retomá-la.
- A validação server-side reduz a superfície de manipulação por um cliente malicioso, mas não elimina o risco por completo: como a física da bola continua sendo calculada no cliente que atua como autoridade (p1), esse jogador ainda pode, dentro dos limites aceitos pelo servidor, enviar posições de bola inconsistentes com uma simulação real.
- O estado de jogadores e salas é mantido apenas em memória, sendo perdido a cada reinicialização do servidor.
