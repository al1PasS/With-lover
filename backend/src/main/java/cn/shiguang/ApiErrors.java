package cn.shiguang;
import org.springframework.web.bind.annotation.*;import org.springframework.web.server.ResponseStatusException;import org.springframework.web.bind.MethodArgumentNotValidException;import org.springframework.dao.OptimisticLockingFailureException;import org.springframework.http.*;import java.util.*;
@RestControllerAdvice
class ApiErrors{
 record Error(String code,String message,String requestId){}
 @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Error> status(ResponseStatusException e){return ResponseEntity.status(e.getStatusCode()).body(new Error("REQUEST_REJECTED",e.getReason()==null?"记录不存在或不可访问":e.getReason(),UUID.randomUUID().toString()));}
 @ExceptionHandler(MethodArgumentNotValidException.class) ResponseEntity<Error> validation(MethodArgumentNotValidException e){return ResponseEntity.badRequest().body(new Error("VALIDATION_ERROR","请检查必填内容和文字长度",UUID.randomUUID().toString()));}
 @ExceptionHandler(OptimisticLockingFailureException.class) ResponseEntity<Error> conflict(Exception e){return ResponseEntity.status(409).body(new Error("EDIT_CONFLICT","这段回忆刚被更新，请保留输入并重新载入后合并",UUID.randomUUID().toString()));}
 @ExceptionHandler(Exception.class) ResponseEntity<Error> other(Exception e){return ResponseEntity.status(500).body(new Error("INTERNAL_ERROR","暂时无法完成，请稍后重试",UUID.randomUUID().toString()));}
}
