export function connect(session, token, receive, status) {
  let socket, retry, stopped=false, delay=500, heartbeat;
  function open(){
    if(stopped)return;
    socket=new WebSocket(location.origin.replace(/^http/,'ws')+'/api/socket/'+session+'?token='+encodeURIComponent(token));
    socket.onopen=()=>{delay=500;status(true);heartbeat=setInterval(()=>send({type:'ping'}),15000);};
    socket.onmessage=e=>{try{receive(JSON.parse(e.data));}catch(error){console.error(error);}};
    socket.onclose=event=>{
      clearInterval(heartbeat);
      if(stopped)return;
      status(false,event.code);
      if(event.code===4000)return;
      retry=setTimeout(open,delay);
      delay=Math.min(delay*2,12000);
    };
  }
  function send(message){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(message));return true;}return false;}
  open();
  return {send,close(){stopped=true;clearTimeout(retry);clearInterval(heartbeat);socket?.close();}};
}
